'use client'
// Sound for the screen recordings (useScreenRecorder).
//
//  • tab audio  — getDisplayMedia({audio}) : the page's own sound (earcons, the 119 alarm, any <audio>). The user must
//                 tick "Share tab audio" in the browser's share dialog.
//  • direct     — (default) the app puts the sound into the recording itself, so it works on every OS and browser: the robot's
//                 lines are fetched as audio from the backend (GET /tts) and played through a WebAudio graph the recorder owns,
//                 the earcons and alarm are made in the same graph, and the microphone is added to it. No tab audio is shared.
//  • system     — the same checkbox, source 'system': "Entire screen" + "Share system audio" (Windows / ChromeOS): everything the
//                 computer plays, which includes the robot's spoken lines (see below). The whole screen is recorded then.
//  • microphone — getUserMedia: the user's voice (qa / ask), with echo cancellation, because the tab's sound comes out
//                 of the speakers and into the mic again.
// Both are mixed into ONE audio track with WebAudio, so the .webm always has a single, ordinary audio track.
//
// What it cannot do: capture the browser's speechSynthesis (the robot's spoken lines) on every platform — Chrome often
// leaves it out of the tab audio. `testRecordingAudio` measures that on this machine; if it is silent, the lines have
// to be played from an <audio> / WebAudio source instead (needs a TTS endpoint on the backend).

import { NOTE_EVENT, noteRecordingAudio } from './recordNote'
import { lastVoiceError, setVoiceSink, speakViaSink } from './recordVoice'

export { NOTE_EVENT, noteRecordingAudio }

const LS_TAB = 'robotapp_record_tab_audio'      // '1' (default) | '0'
const LS_MIC = 'robotapp_record_mic'            // '1' | '0' (default)
const LS_SRC = 'robotapp_record_audio_source'   // 'tab' (default) | 'system'

export type AudioSource = 'direct' | 'tab' | 'system'
export interface AudioPrefs { tab: boolean; mic: boolean; src?: AudioSource }   // tab = "record sound", src = from where

export function getAudioPrefs(): AudioPrefs {
  try {
    return { tab: localStorage.getItem(LS_TAB) !== '0', mic: localStorage.getItem(LS_MIC) === '1',
             src: ((v: string | null) => (v === 'tab' || v === 'system' ? v : 'direct'))(localStorage.getItem(LS_SRC)) }
  } catch { return { tab: true, mic: false, src: 'direct' } }
}
export function setAudioPrefs(p: Partial<AudioPrefs>): void {
  try {
    if (p.tab !== undefined) localStorage.setItem(LS_TAB, p.tab ? '1' : '0')
    if (p.mic !== undefined) localStorage.setItem(LS_MIC, p.mic ? '1' : '0')
    if (p.src !== undefined) localStorage.setItem(LS_SRC, p.src)
  } catch { /* private mode: the choice just is not remembered */ }
}

/** getDisplayMedia options: the current tab, with its sound when `tab` (the page itself stays audible). */
export function displayOptions(prefs: AudioPrefs): DisplayMediaStreamOptions {
  if ((prefs.src ?? 'direct') === 'direct') {     // video only: the sound is made by the app (buildRecordingStream)
    return { video: true, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include' } as unknown as DisplayMediaStreamOptions
  }
  if (prefs.src === 'system') {     // the dialog is for a screen: pick "Entire screen" and tick "Share system audio"
    return { video: true, audio: prefs.tab, systemAudio: 'include', selfBrowserSurface: 'exclude',
             suppressLocalAudioPlayback: false } as unknown as DisplayMediaStreamOptions
  }
  return { video: true, audio: prefs.tab, preferCurrentTab: true, selfBrowserSurface: 'include',
           systemAudio: 'include', suppressLocalAudioPlayback: false } as unknown as DisplayMediaStreamOptions
}

export interface RecordingStream {
  stream: MediaStream          // video + (at most) ONE mixed audio track — what MediaRecorder gets
  dispose: () => void          // closes the mixer and the microphone; the display tracks are the caller's
  audio: string[]              // what is in the sound: 'tab', 'mic'
}

/** The display stream's video plus the chosen sounds mixed into one audio track. Never throws: a refused
 *  microphone or a missing tab audio track is reported through noteRecordingAudio and the recording goes on. */
/** The recorder's audio context. Create it SYNCHRONOUSLY in the click that starts the recording (before the share dialog):
 *  the browser's autoplay policy lets a context made in a gesture run, one made after an await may stay suspended. */
export function makeRecorderContext(): AudioContext | undefined {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new AC()
    ctx.resume().catch(() => {})
    return ctx
  } catch { return undefined }
}

/** Direct source: the sound is made by the app. The robot's lines (recordVoice) and the earcons play through `ctx`
 *  into `dest`, which is the recording's only audio track; the microphone joins it when ticked. */
async function buildDirectStream(display: MediaStream, prefs: AudioPrefs, ctx?: AudioContext): Promise<RecordingStream> {
  const video = display.getVideoTracks()
  const ac = ctx ?? makeRecorderContext()
  if (!prefs.tab || !ac) {
    ac?.close().catch(() => {})
    noteRecordingAudio(prefs.tab ? 'This recording has NO sound: no audio context in this browser.' : 'Sound is off: this recording has NO sound.')
    return { stream: new MediaStream(video), dispose: () => {}, audio: [] }
  }
  const dest = ac.createMediaStreamDestination()
  // A silent source keeps samples flowing into the track while nothing speaks: a recorder given an audio track that
  // delivers no samples at all writes an empty file (110 bytes in the test).
  const keep = ac.createConstantSource()
  keep.offset.value = 0
  keep.connect(dest)
  keep.start()
  let mic: MediaStream | null = null
  const notes: string[] = []
  if (prefs.mic) {
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
      ac.createMediaStreamSource(mic).connect(dest)                 // not to ac.destination: no echo of your own voice
    } catch (e) {
      notes.push(`Microphone not recorded: ${(e as Error)?.name || 'refused'}.`)
    }
  }
  if (ac.state !== 'running') await ac.resume().catch(() => {})
  setVoiceSink({ ctx: ac, dest })
  const audio = ['robot voice', 'beeps', ...(mic ? ['mic'] : [])]
  noteRecordingAudio([...notes, `Recording with sound: ${audio.join(' + ')} (direct; context ${ac.state}). The robot's lines come from the backend's GET /tts.`].join(' '))
  return {
    stream: new MediaStream([...video, ...dest.stream.getAudioTracks()]),
    audio,
    dispose: () => {
      setVoiceSink(null)
      try { keep.stop() } catch { /* already stopped */ }
      mic?.getTracks().forEach(t => t.stop())
      ac.close().catch(() => {})
    },
  }
}

export async function buildRecordingStream(display: MediaStream, prefs: AudioPrefs, directCtx?: AudioContext): Promise<RecordingStream> {
  if ((prefs.src ?? 'direct') === 'direct') return buildDirectStream(display, prefs, directCtx)
  directCtx?.close().catch(() => {})                 // made for a direct recording, not used by the other sources
  const video = display.getVideoTracks()
  const tabTracks = prefs.tab ? display.getAudioTracks() : []
  const notes: string[] = []
  if (prefs.tab && !tabTracks.length) {
    notes.push(prefs.src === 'system'
      ? 'No system audio: choose "Entire screen" and tick "Also share system audio" (Windows / ChromeOS only).'
      : 'No tab audio: tick "Share tab audio" in the share dialog (Chrome: choose "This tab" → "Also share tab audio").')
  }
  let micStream: MediaStream | null = null
  if (prefs.mic) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
    } catch (e) {
      notes.push(`Microphone not recorded: ${(e as Error)?.name || 'refused'}.`)
    }
  }
  const sources: [string, MediaStreamTrack][] = [
    ...tabTracks.map(t => ['tab', t] as [string, MediaStreamTrack]),
    ...(micStream ? micStream.getAudioTracks().map(t => ['mic', t] as [string, MediaStreamTrack]) : [])]
  if (!sources.length) {
    noteRecordingAudio([...notes, 'This recording has NO sound.'].join(' '))
    return { stream: new MediaStream(video), dispose: () => {}, audio: [] }
  }
  // Tab audio alone: record the shared stream as it is (video + its own audio track). A WebAudio mixer in between is
  // only needed to join two sources, and it is one more thing that can stay silent (a suspended AudioContext).
  if (!micStream) {
    noteRecordingAudio([...notes, 'Recording with sound: tab audio.'].join(' '))
    return { stream: new MediaStream([...video, ...tabTracks]), dispose: () => {}, audio: ['tab'] }
  }

  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const ctx = new AC()
  const dest = ctx.createMediaStreamDestination()
  for (const [, t] of sources) ctx.createMediaStreamSource(new MediaStream([t])).connect(dest)   // not to ctx.destination: no echo
  if (ctx.state !== 'running') await ctx.resume().catch(() => {})
  noteRecordingAudio([...notes, `Recording with sound: ${[...new Set(sources.map(s => s[0]))].join(' + ')} (mixer ${ctx.state}).`].join(' '))
  return {
    stream: new MediaStream([...video, ...dest.stream.getAudioTracks()]),
    audio: [...new Set(sources.map(s => s[0]))],
    dispose: () => {
      micStream?.getTracks().forEach(t => t.stop())
      ctx.close().catch(() => {})
    },
  }
}

export interface AudioTestResult { tab: boolean; beepDb: number | null; speechDb: number | null; speechEn?: number; speechKo?: number; text: string }

const dbOf = (peak: number) => (peak > 0 ? Math.round(20 * Math.log10(peak)) : -120)

/** Self-test, ~5 s: share this tab WITH its audio, play a beep (WebAudio) and say a sentence (speechSynthesis),
 *  and measure what reaches the recording. Answers "will the robot's spoken lines be in the video on this machine?".
 *  Needs a click (the share dialog). */
/** Direct source: no share dialog. Builds the recorder's graph, has the backend say a Korean and an English sentence
 *  through it (GET /tts) and measures what reaches the recording's audio track. */
async function testDirect(): Promise<AudioTestResult> {
  const out: AudioTestResult = { tab: true, beepDb: null, speechDb: null, text: '' }
  const ctx = makeRecorderContext()
  if (!ctx) { out.text = 'No audio context in this browser.'; return out }
  const dest = ctx.createMediaStreamDestination()
  setVoiceSink({ ctx, dest })
  try {
    const an = ctx.createAnalyser(); an.fftSize = 2048
    ctx.createMediaStreamSource(dest.stream).connect(an)
    const buf = new Float32Array(an.fftSize)
    let peak = 0, run = true
    const watch = (async () => {
      while (run) { an.getFloatTimeDomainData(buf); for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i])); await new Promise(r => setTimeout(r, 30)) }
    })()
    const say = async (text: string, lang: string): Promise<number | null> => {
      peak = 0
      const ok = await speakViaSink(text, lang, 1)
      return ok ? dbOf(peak) : null
    }
    const ko = await say('녹화 소리 시험입니다. 안녕하세요, 로봇이 말하고 있어요.', 'ko')
    const en = ko === null ? null : await say('Recording audio test. Hello, this is the robot speaking.', 'en')
    run = false; await watch
    if (ko === null) {
      out.text = `Robot voice NOT recorded: ${lastVoiceError() || 'no sound'}. The backend needs GET /tts (restart it) and the internet for gTTS.`
      return out
    }
    out.speechKo = ko; out.speechEn = en ?? -120; out.speechDb = Math.min(ko, out.speechEn)
    const heard = (db: number) => db > -50
    out.text = `Direct recording: robot voice from the backend — Korean ${heard(ko) ? 'recorded' : 'silent'} (${ko} dB), English ${heard(out.speechEn) ? 'recorded' : 'silent'} (${out.speechEn} dB).`
    return out
  } finally {
    setVoiceSink(null)
    ctx.close().catch(() => {})
  }
}

export async function testRecordingAudio(): Promise<AudioTestResult> {
  if ((getAudioPrefs().src ?? 'direct') === 'direct') return testDirect()
  const out: AudioTestResult = { tab: false, beepDb: null, speechDb: null, text: '' }
  let display: MediaStream | null = null
  try {
    display = await navigator.mediaDevices.getDisplayMedia(displayOptions({ ...getAudioPrefs(), tab: true, mic: false }))   // the chosen source
  } catch {
    out.text = 'The share dialog was cancelled.'
    return out
  }
  const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
  try {
    const tracks = display.getAudioTracks()
    if (!tracks.length) {
      out.text = getAudioPrefs().src === 'system'
        ? 'The share had no audio track: choose "Entire screen" and tick "Also share system audio" (Windows / ChromeOS), then test again.'
        : 'The share had no audio track: choose "This tab" and tick "Also share tab audio", then test again.'
      return out
    }
    out.tab = true
    const an = ctx.createAnalyser(); an.fftSize = 2048
    ctx.createMediaStreamSource(new MediaStream([tracks[0]])).connect(an)
    const buf = new Float32Array(an.fftSize)
    const peakFor = async (ms: number): Promise<number> => {
      let peak = 0; const t0 = performance.now()
      while (performance.now() - t0 < ms) {
        an.getFloatTimeDomainData(buf)
        for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]))
        await new Promise(r => setTimeout(r, 30))
      }
      return peak
    }
    // 1) a beep through WebAudio (the earcons are this kind of sound)
    const osc = ctx.createOscillator(), g = ctx.createGain()
    g.gain.value = 0.2; osc.frequency.value = 700; osc.connect(g).connect(ctx.destination)
    osc.start(); const beep = await peakFor(700); osc.stop()
    // 2) spoken sentences through speechSynthesis (the robot's lines): English and Korean — the voice differs per
    //    language, and one may be recorded while the other is not
    const sp = window.speechSynthesis
    const say = async (text: string, lang: string): Promise<number> => {
      if (!sp) return 0
      sp.cancel()
      const u = new SpeechSynthesisUtterance(text); u.lang = lang
      const v = sp.getVoices().find(x => x.lang.replace('_', '-') === lang) ?? sp.getVoices().find(x => x.lang.split(/[-_]/)[0] === lang.split('-')[0])
      if (v) u.voice = v
      sp.speak(u)
      const pk = await peakFor(3500)
      sp.cancel()
      return pk
    }
    const speechEn = await say('Recording audio test. Hello, this is the robot speaking.', 'en-US')
    const speechKo = await say('녹화 소리 시험입니다. 안녕하세요, 로봇이 말하고 있어요.', 'ko-KR')
    const speech = Math.min(speechEn, speechKo || speechEn)      // the worse of the two decides
    out.speechEn = dbOf(speechEn); out.speechKo = dbOf(speechKo)
    out.beepDb = dbOf(beep); out.speechDb = dbOf(speech)
    const heard = (db: number) => db > -50
    out.text = `Sound: ${heard(out.beepDb) ? 'recorded' : 'silent'} (${out.beepDb} dB). `
             + `Spoken lines: English ${heard(out.speechEn!) ? 'recorded' : 'NOT recorded'} (${out.speechEn} dB), Korean ${heard(out.speechKo!) ? 'recorded' : 'NOT recorded'} (${out.speechKo} dB).`
             + (heard(out.speechDb) ? '' : ' The robot\'s spoken lines will be missing from the video: use the "whole system" source (Windows) or play them from an audio element.')
    return out
  } finally {
    display.getTracks().forEach(t => t.stop())
    ctx.close().catch(() => {})
  }
}
