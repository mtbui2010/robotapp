'use client'
// Sound for the screen recordings (useScreenRecorder).
//
//  • system — "Entire screen" + "Share system audio" (Windows / ChromeOS): everything the computer plays, so the robot's voice is
//              the SAME browser voice the user hears without a recording. The default there. The whole screen is recorded.
//  • direct — works on every OS and browser: the app puts the sound into the recording itself. The user still hears the
//              browser's voice; the recording gets the backend's voice of the same lines (GET /tts, a different voice) and
//              the earcons, made in a WebAudio graph the recorder owns. No audio is shared.
//  • tab    — getDisplayMedia({audio}) of this tab: needs "Also share tab audio", and Chrome often leaves the browser's own
//              voice (speechSynthesis) out of it.
// The user's answers (🎤): in every source the stream the dashboard listens with (recordPhrase, what Whisper hears) is tapped
// into the recording for the length of each listen (recordVoice.tapMic): exactly the answers, no room noise, no second microphone.
// With a tapped microphone the sounds are mixed with WebAudio into ONE audio track; without one the shared stream is recorded
// as it is (system / tab) so a suspended mixer cannot silence it.

import { NOTE_EVENT, noteRecordingAudio } from './recordNote'
import { lastVoiceError, setVoiceSink, speakViaSink } from './recordVoice'

export { NOTE_EVENT, noteRecordingAudio }

const LS_TAB = 'robotapp_record_tab_audio'      // '1' (default) | '0'
const LS_MIC = 'robotapp_record_mic'            // '1' | '0' (default)
const LS_SRC = 'robotapp_record_audio_source_v2'   // 'system' | 'direct' | 'tab'; default: system on Windows / ChromeOS, else direct

export type AudioSource = 'system' | 'direct' | 'tab'

/** system audio can be shared on Windows and ChromeOS only; elsewhere the direct source is the one that works. */
export function defaultSource(): AudioSource {
  return typeof navigator !== 'undefined' && /Windows|CrOS/.test(navigator.userAgent) ? 'system' : 'direct'
}
export interface AudioPrefs { tab: boolean; mic: boolean; src?: AudioSource }   // tab = "record sound", src = from where

export function getAudioPrefs(): AudioPrefs {
  try {
    return { tab: localStorage.getItem(LS_TAB) !== '0', mic: localStorage.getItem(LS_MIC) === '1',
             src: ((v: string | null) => (v === 'tab' || v === 'system' || v === 'direct' ? v : defaultSource()))(localStorage.getItem(LS_SRC)) }
  } catch { return { tab: true, mic: false, src: defaultSource() } }
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
  if ((prefs.src ?? defaultSource()) === 'direct') {     // video only: the sound is made by the app (buildRecordingStream)
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

/** Does this recording need the recorder's audio context? (create it in the click: see makeRecorderContext) */
export function needsRecorderContext(prefs: AudioPrefs): boolean {
  return prefs.tab && ((prefs.src ?? defaultSource()) === 'direct' || prefs.mic)
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
  // The user's voice is not captured by a second microphone stream: recordPhrase's own stream (what the robot hears) is tapped
  // into the recording while it listens (recordVoice.tapMic), so the clip has exactly the answers and no room noise.
  if (ac.state !== 'running') await ac.resume().catch(() => {})
  setVoiceSink({ ctx: ac, dest, mic: prefs.mic, voice: true })
  const audio = ['robot voice (the backend\'s)', 'beeps', ...(prefs.mic ? ['your answers (while the robot listens)'] : [])]
  noteRecordingAudio(`Recording with sound: ${audio.join(' + ')} (direct; context ${ac.state}). You still hear the browser's voice; the file has the backend's voice of the same lines (GET /tts).`)
  return {
    stream: new MediaStream([...video, ...dest.stream.getAudioTracks()]),
    audio,
    dispose: () => {
      setVoiceSink(null)
      try { keep.stop() } catch { /* already stopped */ }
      ac.close().catch(() => {})
    },
  }
}

export async function buildRecordingStream(display: MediaStream, prefs: AudioPrefs, ctx?: AudioContext): Promise<RecordingStream> {
  const src = prefs.src ?? defaultSource()
  if (src === 'direct') return buildDirectStream(display, prefs, ctx)
  const video = display.getVideoTracks()
  const shared = prefs.tab ? display.getAudioTracks() : []
  const missing = prefs.tab && !shared.length
    ? (src === 'system'
        ? 'No system audio: choose "Entire screen" and tick "Also share system audio" (Windows / ChromeOS only).'
        : 'No tab audio: tick "Share tab audio" in the share dialog (Chrome: choose "This tab" → "Also share tab audio").')
    : ''
  // No microphone tap: record the shared stream as it is (video + its own audio track), no mixer to stay silent.
  if (!prefs.mic || !prefs.tab || !ctx) {
    ctx?.close().catch(() => {})
    noteRecordingAudio(shared.length ? `Recording with sound: ${src} audio.` : `${missing} This recording has NO sound.`.trim())
    return { stream: new MediaStream([...video, ...shared]), dispose: () => {}, audio: shared.length ? [src] : [] }
  }
  // With the microphone: the shared sound and the user's answers (tapped from the listen stream) are mixed into one track.
  const dest = ctx.createMediaStreamDestination()
  const keep = ctx.createConstantSource()                           // samples keep flowing while nobody speaks
  keep.offset.value = 0
  keep.connect(dest)
  keep.start()
  for (const t of shared) ctx.createMediaStreamSource(new MediaStream([t])).connect(dest)   // not to ctx.destination: no echo
  if (ctx.state !== 'running') await ctx.resume().catch(() => {})
  setVoiceSink({ ctx, dest, mic: true, voice: false })
  const audio = [...(shared.length ? [src] : []), 'your answers (while the robot listens)']
  noteRecordingAudio(`${missing} Recording with sound: ${audio.join(' + ')} (mixer ${ctx.state}).`.trim())
  return {
    stream: new MediaStream([...video, ...dest.stream.getAudioTracks()]),
    audio,
    dispose: () => {
      setVoiceSink(null)
      try { keep.stop() } catch { /* already stopped */ }
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
  setVoiceSink({ ctx, dest, mic: false, voice: true })
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
    out.text = `Direct recording: the backend's voice goes into the file (you still hear the browser's) — Korean ${heard(ko) ? 'recorded' : 'silent'} (${ko} dB), English ${heard(out.speechEn) ? 'recorded' : 'silent'} (${out.speechEn} dB).`
    return out
  } finally {
    setVoiceSink(null)
    ctx.close().catch(() => {})
  }
}

export async function testRecordingAudio(): Promise<AudioTestResult> {
  if ((getAudioPrefs().src ?? defaultSource()) === 'direct') return testDirect()
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
