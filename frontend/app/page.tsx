'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import DevicePanel, { type ActiveTarget } from '../components/DevicePanel'
import AgentPanel   from '../components/AgentPanel'
import CameraFeed   from '../components/CameraFeed'
import TeleopBar    from '../components/TeleopBar'
import RecorderBar  from '../components/RecorderBar'
import DataPanel    from '../components/DataPanel'
import FleetPanel   from '../components/FleetPanel'
import { useFleets } from '../components/useFleets'
import { useFleetChat } from '../lib/useFleetChat'
import { parseSelection, selectorOptions } from '../lib/fleetEdit'
import { FLEET_STOP_HINT } from '../lib/fleetView'
import { useRecorder } from '../lib/useRecorder'
import { usePoses } from '../lib/usePoses'
import { useTeleop } from '../lib/useTeleop'
import SkillPanel   from '../components/SkillPanel'
import EnvPanel     from '../components/EnvPanel'
import MapPanel     from '../components/MapPanel'
import PlannerPromptPanel from '../components/PlannerPromptPanel'
import GuidePanel   from '../components/GuidePanel'
import PlanPanel    from '../components/PlanPanel'
import ButtonPanel  from '../components/ButtonPanel'
import ChatPanel, { type ChatLine } from '../components/ChatPanel'
import { api, ROBOTS_CHANGED_EVENT } from '../lib/api'
import type { Robot } from '../lib/api'
import { reduceSteps } from '../lib/planSteps'
import { useForeignRun } from '../lib/useForeignRun'
import ForeignRunBadge from '../components/ForeignRunBadge'
import SequenceBar from '../components/SequenceBar'
import { splitPlans, isSequence, barGuard, lostVerdict, start as seqStart, next as seqNext, retry as seqRetry, skip as seqSkip, IDLE as SEQ_IDLE } from '../lib/planSequence'
import { useVoiceOutput, stillWorkingPhrase } from '../lib/useVoiceOutput'
import { speakAndWait, recognizeOnce, recordPhrase, primeMic, playEarcon, playAlarm, stopRecording, abortRecognition } from '../lib/hriVoice'
import { answerBy, createEchoGuard } from '../lib/chatMic'
import { useHandsFree } from '../lib/useHandsFree'
import { noteForListenReply, stopAction, stopLabel, canStop, canType, isLost, needsForce } from '../lib/chatRun'
import { useRobotSessions } from '../lib/useRobotSessions'
import { robotKey, cancelTarget, startBlock, statusMap, optionText, appendLine, settleHeard, closeLine, verdictOf, beginRun, endRun, patch, HEARD_PENDING, type SessionKey, type RunHandles } from '../lib/robotSessions'
import { sanitizeTask, downloadJpeg, isFailureEvent, stopNudge, newHriEpoch, enqueueHri, handsFreeBusy, ownedByDropped, sessionUrl, micMayEnd } from '../lib/runHelpers'
import { LS_PLANNER, PLANNER_EVENT, DEFAULT_PLANNER, LS_PLAN_ONLY, storedPlanOnly, storedPlanner, type PlannerMethod } from '../lib/planner'
import { useScreenRecorder } from '../lib/useScreenRecorder'
import { saveDataset, saveRunSummary, runFolder } from '../lib/datasetLog'
import type { Outcome } from '../lib/datasetLog'
import { pinTabPref, readTabPref, writeTabPref } from '../lib/tabPref'
import type { ClientEntry, AgentEvent, Lang } from '../lib/types'
import { useRobotLanguages } from '../lib/useRobotLanguages'
import { useRobotEpoch } from '../lib/useRobotEpoch'
import { mismatchTitle, targetBadges, targetTitle } from '../lib/targetBadge'
import { resolveLanguage, languageOptions, speechLanguage, supportedLanguages, toggleLanguage, LANG_AUTO, type RobotLanguages } from '../lib/robotLanguages'
import LanguagePicker from '../components/LanguagePicker'
import type { Step } from '../components/PlanPanel'


// Control-bar pickers (KO / 🎤 / 📷 / 🔁): no native ▾, so the bar fits one row of the w-72 column
const PICK = 'appearance-none text-center text-xs border border-gray-300 rounded px-1 py-1 bg-white hover:border-gray-400 cursor-pointer disabled:opacity-50'

export default function Home() {
  const [clients, setClients]         = useState<ClientEntry[]>([])
  const [skillRefreshKey, setSkillRefreshKey] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)   // collapsed by default (2026-10-27); ▶ opens it
  const [planOpen, setPlanOpen]       = useState(true)
  const [mainTab, setMainTab]         = useState<'cameras' | 'map' | 'data' | 'fleet'>('cameras')
  const [fleetKey, setFleetKey]       = useState(0)   // a fleet chosen in the selector: the Fleet tab starts over on its manager
  const fleetStopRef = useRef<(() => void) | null>(null)   // the open Fleet tab puts its Stop all here; Cancel calls it
  const switchRobotRef = useRef<((name: string) => Promise<void>) | null>(null)   // DevicePanel's robot switch, for the tab-row drop-down
  const fl = useFleets(() => { setMainTab('fleet'); setFleetKey(k => k + 1); setChatOpen(true) })   // this tab's fleet and the fleets of the drop-down
  const [robotList, setRobotList] = useState<Robot[]>([])
  const readRobotList = useCallback(() => setRobotList(api.listRobots()), [])
  useEffect(() => { readRobotList() }, [readRobotList, fl.active, fl.fleets])
  // Remote control + Record are only used to make data: hidden until the operator asks (kept in this browser); never hidden while recording or while teleop drives the arm
  const [dataTools, setDataTools]       = useState(false)
  useEffect(() => { try { setDataTools(localStorage.getItem('robotapp_data_tools') === '1') } catch { /* off */ } }, [])
  const toggleDataTools = () => setDataTools(v => { try { localStorage.setItem('robotapp_data_tools', v ? '0' : '1') } catch { /* per-viewer convenience */ } return !v })
  const [target, setTarget]           = useState<ActiveTarget | null>(null)   // robot + site this tab drives
  const sess = useRobotSessions()   // one session per robot (run, socket, chat log, plan): lib/robotSessions.ts. The page draws the SHOWN one
  const { get, put, set, apply, applyAt, dispatch, handles: H, shownKey, getStore, sameKey } = sess
  const { running, events: agentEvents, steps: agentSteps, logImage, runMethod, trial, qaLog, listenId, choice, qaSkill, heardLang, run: rs, seq } = sess.shown
  useEffect(() => { window.addEventListener(ROBOTS_CHANGED_EVENT, readRobotList); return () => window.removeEventListener(ROBOTS_CHANGED_EVENT, readRobotList) }, [readRobotList])   // add / rename / remove / edit url, from any panel
  const dropRecRef = useRef<(toks: string[]) => void>(() => {})   // a dropped robot that owns the screen recorder releases it (its socket closes silently)
  useEffect(() => { sess.reconcileRobots([...robotList, { name: '' }], t => dropRecRef.current(t)) }, [robotList, sess.reconcileRobots])   // a removed or renamed robot ends its session
  useEffect(() => { sess.choose(robotKey(target?.robot ?? ''), sessionUrl(target?.url, api.getAgentUrl())) }, [target, sess.choose])   // the shown session follows the robot the tab shows
  const [fleetLog, setFleetLog]       = useState<ChatLine[]>([])   // the Fleet chat's log (the fleet manager is not a robot session)
  const [voiceOut, setVoiceOut]       = useState(true)   // speak milestones by default
  // 🔊 off = no sound at all (2026-10-27): milestones, and also the skills' own lines (announce / ask / qa
  // `speak`, a listen's prompt), the earcons and the alarm — read live, so unticking mid-run silences the rest
  const voiceOutRef = useRef(voiceOut)
  voiceOutRef.current = voiceOut
  const [voiceLang, setVoiceLang]     = useState('en')

  // How fast the browser speaks: the robot's HRI_CONFIGS.speech_rate (Global Configs), read on mount and at
  // every run; a speak / listen event's own rate (HRI_CONFIGS at that moment, or a call's rate=) wins for that line.
  // English lines use HRI_CONFIGS.speech_rate_en when set (English voices sound rushed at the Korean rate).
  const [speechRates, setSpeechRates] = useState<{ base?: number; en?: number }>({})
  const speechRatesRef = useRef<{ base?: number; en?: number }>({})
  const rateFor = useCallback((lang?: string | null) => {
    const r = speechRatesRef.current
    return (lang ?? '').toLowerCase().startsWith('en') && r.en ? r.en : r.base
  }, [])
  const takeRates = useCallback((c: Record<string, unknown>) => {
    const num = (v: unknown) => (Number(v) > 0 ? Number(v) : undefined)
    const next = { base: num(c.speech_rate), en: num(c.speech_rate_en) }
    const cur = speechRatesRef.current
    if (next.base === cur.base && next.en === cur.en) return
    speechRatesRef.current = next
    setSpeechRates(next)
  }, [])
  const loadSpeechRate = useCallback(() => {
    api.getSkillConfig('HRI_CONFIGS').then(c => { if (c) takeRates(c) }).catch(() => {})
  }, [takeRates])
  useEffect(() => { loadSpeechRate() }, [loadSpeechRate])

  // Dashboard voice output — speaks each event's `say` (robot also speaks via backend).
  const { speak, supported: voiceSupported, missingVoice: voiceMissing } = useVoiceOutput({ enabled: voiceOut, lang: voiceLang,
    rate: voiceLang.toLowerCase().startsWith('en') && speechRates.en ? speechRates.en : speechRates.base })
  const { recordEnabled, toggleRecord, beginRecording, endRecording, manualRecording, toggleManualRecord, setRecordingPrefix } = useScreenRecorder()

  const emit = useCallback((key: SessionKey, events: AgentEvent[], steps: Step[]) => set(key, { events, steps }), [set])

  const robotLangsRef = useRef<RobotLanguages | null>(null)   // the SHOWN robot's languages; a run freezes a copy in its handles
  const runLang = (h: RunHandles, l: string) => speechLanguage(l, h.langs, h.heard)
  const micOwnerRef = useRef<SessionKey | null>(null)         // the robot whose listen job holds the browser's one mic
  const endMic = (key: SessionKey) => { if (micMayEnd(micOwnerRef.current, key, sameKey)) { stopRecording(); abortRecognition() } }
  const recOwnerRef = useRef<SessionKey | null>(null)         // ONE screen recorder per tab: only the session that began it ends it
  const endRec = (key: SessionKey, outcome?: 'succeed' | 'failed') => { if (recOwnerRef.current !== null && sameKey(recOwnerRef.current, key)) { recOwnerRef.current = null; endRecording(outcome) } }
  dropRecRef.current = toks => { if (ownedByDropped(recOwnerRef.current, toks)) { recOwnerRef.current = null; endRecording() } }
  const takeListen = (key: SessionKey, id: string | null) => {
    set(key, { listenId: id })
    dispatch(key, { t: id ? 'listen' : 'answered' })
  }
  // Runs started by someone else on this robot (the fleet manager ...) are drawn in the SHOWN robot's session, from its read-only /ws/events
  const { foreignRun, noteOwnEvent } = useForeignRun({ robotUrl: target?.url, ownRunning: () => get(shownKey()).running,
    show: (e, s) => emit(shownKey(), e, s), showImage: b => set(shownKey(), { logImage: b }) })
  const handsFreeRef = useRef(false)    // the chat's mic toggle, read by the listen handler (set below, from state)
  const echoGuard = useRef(createEchoGuard()).current
  // a line the robot says: robot bubble (even with 🔊 off), echo guard, speech-time estimate for the mic. key null = the Fleet chat
  const addQaLine = (key: SessionKey | null, who: ChatLine['who'], text: string, kind?: ChatLine['kind']) => {
    if (who === 'robot') {
      echoGuard.note(text, Date.now())
      if (key) { const h = H(key); h.speechUntil = Math.max(h.speechUntil, Date.now() + 400 + 90 * text.length) }
    }
    if (key) put(key, s => ({ ...s, qaLog: appendLine(s.qaLog, who, text, kind) }))
    else setFleetLog(l => appendLine(l, who, text, kind))
  }
  // kcare ask did not understand: its options as buttons (a helper clicks; the user is blind). When the last click came: a listen
  // queued before it is answered by the click (h.choiceAt) — its prompt is cut and its mic not opened.
  const pickChoice = (opt: string) => {
    const key = shownKey(), h = H(key), id = get(key).choice?.id
    if (!id) return
    set(key, { choice: null })
    h.choiceAt = Date.now()
    endMic(key)                         // the click answers: end the recording in progress
    h.textAsk?.(null)                   // or the typed answer being waited for
    if (voiceOutRef.current) { try { window.speechSynthesis.cancel() } catch { /* not supported */ } }  // and the question
    addQaLine(key, 'user', `${opt} (화면 선택)`)
    takeListen(key, null)
    api.answerListenAt(get(key).url, id, opt).catch(() => {})
  }
  const fireRef = useRef<(key: SessionKey) => void>(() => {})

  // One WS run of the current args. On completion it either chains the next
  // iteration (repeat) or finalizes (setRunning false).
  const fire = useCallback((regKey: SessionKey) => {
    const key = sess.stable(regKey)   // from here on the run holds an immutable id: a rename or a reused name cannot redirect its events
    const h = H(key)
    const a = h.args
    if (!a) return
    const url = get(key).url         // frozen by beginRun: picking another robot cannot move this run
    const live = () => sameKey(shownKey(), key)   // only the robot on screen speaks, opens the chat or the mic; a background run writes its own log
    put(key, s => ({ ...s, trial: s.trial + 1 }))   // count this iteration
    h.ws?.close()
    emit(key, [], [])
    h.heard = null
    set(key, { heardLang: null })
    if (live()) setVoiceLang(runLang(h, a.lang))
    const runStart = Date.now()
    if (a.screenRec) setRecordingPrefix('')          // reset; set from the first step's task below
    // Planner actually used: structured/explicit plans run directly; otherwise
    // it's the chosen planner ('grace' | 'direct').
    set(key, { runMethod: a.direct ? 'direct' : (a.planner ?? 'grace') })
    if (a.screenRec && live() && !recOwnerRef.current) { recOwnerRef.current = key; beginRecording() }   // no-op unless screen recording is enabled; a quick-button run never starts one

    // Only the backend target writes the dataset to disk on the server; the
    // frontend target keeps the backend hands-off and downloads log images here.
    const frontendLog = a.logData && a.logTarget === 'frontend'
    let prefix = ''                 // sanitized first task — shared by video + images
    let imgSeq = 0

    // Frontend dataset logging. With "failed only" we buffer captures and flush
    // them just once, when the run turns out to be a failure; with "all" every
    // capture is written as it arrives.
    // Folder is <datetime>_<first task>; resolved lazily on the first write so
    // the plan's opening task (known at step_start) can name it.
    const startedAt = new Date()
    let runDir = ''
    const dir = () => runDir || (runDir = runFolder(startedAt, prefix))
    let dsSeq = 0
    let runFailed = false

    // HRI skills (source='dashboard'): speak and listen strictly in the order the skill asked (enqueueHri, above
    // `fire`), so the mic never opens while the browser is still talking — it would transcribe the robot's own question.
    // Milestones are narrated by useVoiceOutput, which speaks outside this queue: hriBusyRef (jobs queued) keeps a
    // `plan_ready` / `step_start` phrase from playing while the mic is open, and its speechSynthesis.cancel() from cutting
    // the skill's own question mid-sentence.
    newHriEpoch(h)
    h.stopReq = false
    dispatch(key, { t: 'start' })
    const epoch = h.epoch
    const aborted = () => h.epoch !== epoch || h.stopReq   // Stop / Reset since this run began
    // Stop a milestone that is already playing, just before the browser speaks
    // for the skill (a phrase queued before the HRI event still runs).
    // Not with 🔊 off: nothing of ours is playing then (unticking cancelled it), and a cancel here can cut the
    // speech of ANOTHER dashboard window on the same computer (2026-10-27: a muted window running qa — a cancel
    // before every listen — silenced the other window's lines).
    const silenceNarration = () => {
      if (!voiceOutRef.current || !live()) return
      try { window.speechSynthesis.cancel() } catch { /* not supported */ }
    }

    // Captures are grouped by the step that produced them and held until that
    // step reports back, because the outcome that names the file is not known
    // when the capture arrives. Anything emitted outside a step (planning,
    // teardown) lands in RUN_BUCKET and is labelled with the run's verdict.
    type Item =
      | { kind: 'dataset'; ds: NonNullable<AgentEvent['dataset']> }
      | { kind: 'image'; b64: string }
    const RUN_BUCKET = -1
    let curStep = RUN_BUCKET
    const buckets = new Map<number, Item[]>()
    const stepOutcome = new Map<number, Outcome>()

    const bucket = (item: Item, step: number = curStep) => {
      const items = buckets.get(step)
      if (items) items.push(item)
      else buckets.set(step, [item])
    }
    const writeBucket = (step: number, outcome: Outcome) => {
      const items = buckets.get(step)
      if (!items) return
      buckets.delete(step)
      for (const it of items) {
        if (it.kind === 'dataset') void saveDataset(it.ds, dir(), ++dsSeq, outcome)
        else downloadJpeg(it.b64, `${dir()}/step_${String(++imgSeq).padStart(3, '0')}_${outcome}.jpg`)
      }
    }
    // Everything whose step has already finished. Used both as steps complete
    // (log-all) and at the moment a failed-only run turns out to have failed.
    const writeSettled = () => {
      for (const step of [...buckets.keys()].sort((x, y) => x - y)) {
        const o = stepOutcome.get(step)
        if (o) writeBucket(step, o)
      }
    }
    // Whatever is still held when the run ends: steps that never reported, plus
    // RUN_BUCKET. The run verdict is the best label available for those.
    const writeRest = (outcome: Outcome) => {
      for (const step of [...buckets.keys()].sort((x, y) => x - y)) {
        writeBucket(step, stepOutcome.get(step) ?? outcome)
      }
    }

    const ws = api.agentWsAt(url)
    h.ws = ws

    ws.onopen = () => ws.send(JSON.stringify({
      prompt: a.finalPrompt, lang: a.lang, direct: a.direct, planner: a.planner,
      plan_only: a.planOnly, log_data: a.logData,
      log_mode: a.logTarget, log_all: a.logAll,
    }))

    ws.onmessage = e => {
      const ev: AgentEvent = JSON.parse(e.data)
      ev._rx = Date.now()                  // receive time: the plan list shows step durations from it
      noteOwnEvent(ev)                     // this run's id: its copy on /ws/events is not drawn again
      const cur = get(key)
      const newEvents = [...cur.events, ev]
      let newSteps = cur.steps

      // Speak the milestone phrase on the dashboard (no-op if voice output is
      // off, or for Button-panel shortcuts which run silently). Each milestone
      // also restarts the "still working" nudge, so it only fires when a step
      // goes quiet for a while.
      // BACKEND-WORKAROUND(hri-narrator-gate): no narration while an HRI speak / listen is queued
      if (ev.say && ev.event !== 'done' && ev.event !== 'error') addQaLine(key, 'robot', ev.say, 'say')
      const talk = a.voice && ev.say && live()
      if (talk && h.busy === 0) {
        speak(ev.say!, ev.say_lang, rateFor(ev.say_lang ?? runLang(h, a.lang)))
        stopNudge(h)
        if (ev.event !== 'done' && ev.event !== 'error') {
          const nudgeLang = ev.say_lang ?? runLang(h, a.lang)      // "still working" in the language of the last phrase
          h.nudge = setInterval(() => { if (live()) speak(stillWorkingPhrase(nudgeLang), nudgeLang, rateFor(nudgeLang)) }, 15_000)
        }
      } else if (talk && voiceOutRef.current) {
        // The HRI queue is still talking (ask's read-back "…, 알겠습니다" is not
        // waited for, so the next step starts right away): this milestone used to
        // be dropped ("가운데 선반 이동…" after ask was never said). Say it after
        // the queue, in order — still never while the mic is open.
        const line = ev.say!
        stopNudge(h)
        const lineLang = ev.say_lang ?? runLang(h, a.lang)
        enqueueHri(h, async () => { if (voiceOutRef.current) await speakAndWait(line, lineLang, rateFor(lineLang)) })
      }
      if (ev.qa_state) set(key, { qaSkill: !!ev.qa_state.active })
      if (ev.choose) set(key, { choice: { id: ev.choose.id, options: ev.choose.options, prompt: ev.choose.prompt ?? '' } })
      if (ev.choose_close) {
        const closed = ev.choose_close
        put(key, s => (s.choice && s.choice.id === closed ? { ...s, choice: null } : s))
      }
      if (ev.event === 'clarify' && ev.question) addQaLine(key, 'robot', String(ev.question))
      if (ev.event === 'done' || ev.event === 'error') {
        put(key, s => ({ ...s, qaLog: [...s.qaLog, closeLine(ev)], choice: null, qaSkill: false }))
        stopNudge(h)
        dispatch(key, { t: 'done' })
        h.textAsk?.(null)          // a typed question can no longer be asked
      }

      // A skill is talking to the user through this browser. The "still
      // working" nudge must not speak over it — or into the open mic.
      if (ev.speak || ev.listen || ev.alarm || ev.quiet) stopNudge(h)
      if (ev.speak && !aborted()) {
        const line = ev.speak
        const lang = ev.speak_lang ?? runLang(h, a.lang)
        const rate = ev.speak_rate ?? rateFor(lang)
        addQaLine(key, 'robot', line)
        const speakId = ev.speak_id
        enqueueHri(h, async () => {
          silenceNarration()
          if (voiceOutRef.current && live()) await speakAndWait(line, lang, rate)
          // announce(wait=True): tell the skill the line has been spoken.
          if (speakId) await api.answerListenAt(url, speakId, '').catch(() => {})
        })
      }
      if (ev.alarm && !aborted()) {
        // A (simulated) 119 call: the siren, after the line before it and before the one after it.
        const al = ev.alarm
        enqueueHri(h, async () => {
          silenceNarration()
          if (voiceOutRef.current && live()) await playAlarm(al.volume ?? 0.6, al.cycles ?? 3)
        })
      }
      if (ev.listen && !aborted()) {
        const req = ev.listen
        const lang = req.lang ?? runLang(h, a.lang)
        const rate = req.rate ?? rateFor(lang)
        if (req.prompt) addQaLine(key, 'robot', req.prompt)
        h.textAsk?.(null)          // an older question still waiting for typing is superseded, it cannot hold the queue
        takeListen(key, req.id)
        if (h.fromChat && live()) setChatOpen(true)   // a chat run opens the card; a Structured run only pulses the Chat button
        const clearListen = () => { if (get(key).listenId === req.id) takeListen(key, null) }
        const queuedAt = Date.now()
        const answeredByClick = () => aborted() || h.choiceAt >= queuedAt   // nothing to post: answered by a click, or stopped / reset
        // Typed answer: no mic. The chat's Send answers directly (sendChat); this wait only holds the queue, with no
        // timeout of its own (the backend decides when to give up; a newer question, Stop and Reset end it).
        const waitTyped = async () => {
          const typed = await new Promise<string | null>(resolve => { h.textAsk = resolve })
          h.textAsk = null
          if (typed !== null && !aborted()) await api.answerListenAt(url, req.id, typed).catch(() => {})
        }
        const settle = (t: string | null) => put(key, s => ({ ...s, qaLog: settleHeard(s.qaLog, t) }))
        const listenJob = async () => {
          if (answeredByClick()) return
          silenceNarration()
          if (req.prompt && voiceOutRef.current && live()) await speakAndWait(req.prompt, lang, rate)
          if (answeredByClick()) return
          if (!live() || answerBy({ runFromChat: h.fromChat, micOn: handsFreeRef.current, listenMode: req.mode }) === 'typing') {
            // no mic: the backend asked for text, this is a chat run with the chat's mic off, or this robot is not the one on screen (one mic)
            await waitTyped()
            return
          }
          // "your turn": played to the end before the mic opens; "got it" once a phrase was taken
          const ear = voiceOutRef.current ? (req.earcon ?? 0) : 0
          if (ear > 0) {
            await playEarcon('listen', ear)
            await new Promise(r => setTimeout(r, 100))
            if (answeredByClick()) return
          }
          if (req.capture === 'whisper') {
            // Record only; the robot transcribes it with Whisper (stt connection).
            micOwnerRef.current = key
            const rec = await recordPhrase(req.max_sec ?? 8, req.silence_sec ?? 1.5).finally(() => { if (micOwnerRef.current === key) micOwnerRef.current = null })
            if (answeredByClick()) return            // typed / clicked meanwhile: that answer stands
            if (rec.error) {                  // e.g. not-allowed: the skill falls back to typing
              addQaLine(key, 'system', `⚠ microphone not available (${rec.error}): type your answer`)
              await api.answerListenAt(url, req.id, '', rec.error, rec.note).catch(() => {})
              return
            }
            if (rec.blob && ear > 0) playEarcon('heard', ear)
            if (rec.blob) addQaLine(key, 'user', HEARD_PENDING)
            const res = await api.answerListenAudioAt(url, req.id, rec.blob, rec.mime, rec.note)
            settle(res.text || null)
            if (aborted()) return
            const goneNote = noteForListenReply(res)
            if (goneNote) { addQaLine(key, 'system', goneNote); return }
            if (res.error) {
              // The speech server failed (down, out of GPU memory, HTTP 5xx). The backend still waits for this listen:
              // say so, and keep the question open for a typed answer (input enabled) instead of treating it as silence.
              addQaLine(key, 'system', `⚠ speech recognition failed (${res.error}): type your answer`)
              await waitTyped()
              return
            }
            return
          }
          micOwnerRef.current = key       // the browser recogniser is the one mic too
          const heard = await recognizeOnce(lang, req.max_sec ?? 8).finally(() => { if (micOwnerRef.current === key) micOwnerRef.current = null })
          if (answeredByClick()) return              // typed / clicked meanwhile: that answer stands
          if (heard.text && echoGuard.isEcho(heard.text, Date.now())) {
            console.info('[hri] dropped a transcript that echoes the robot:', heard.text)
            heard.text = ''
          }
          if (heard.text && ear > 0) playEarcon('heard', ear)
          if (heard.text) addQaLine(key, 'user', heard.text)
          else if (heard.error) addQaLine(key, 'system', `⚠ microphone / speech recognition not available (${heard.error}): type your answer`)
          else if (heard.note) console.info('[hri] nothing recognised:', heard.note)
          await api.answerListenAt(url, req.id, heard.text, heard.error, heard.note).catch(() => {})
        }
        enqueueHri(h, () => listenJob().finally(clearListen))
      }

      // Failed-case filter: once this run is known to have failed, flush the
      // captures buffered so far and keep saving the rest as they arrive.
      // Track the failure as a fact in BOTH modes — it names run.json and the
      // leftover captures. It used to be set only under the failed-only filter,
      // which was fine while it was just a flush trigger but made a log-all run
      // with a failed step report itself as a success.
      if (frontendLog && !runFailed && isFailureEvent(ev)) {
        runFailed = true
        // The failed-only filter now wants everything held so far.
        if (!a.logAll) writeSettled()
      }
      if (frontendLog && ev.dataset) bucket({ kind: 'dataset', ds: ev.dataset })

      if (ev.event === 'step_start') {
        // First step names the whole run — use it as the filename prefix.
        if (!prefix && ev.task) {
          prefix = sanitizeTask(ev.task)
          // Same name datasetLog gives the capture folder, so the .webm and the
          // folder for one run sort next to each other.
          if (recOwnerRef.current !== null && sameKey(recOwnerRef.current, key)) setRecordingPrefix(dir())
        }
        // SAGE events carry `index` / `action` / `object` instead of `step` / `total` / `task`
        const stepNo = ev.step ?? ev.index
        if (stepNo != null) curStep = stepNo
        newSteps = reduceSteps(newSteps, ev)
      } else if (ev.event === 'step_done') {
        const doneNo = ev.step ?? ev.index      // SAGE: `index`, reused after a recovery splice → the running row
        if (frontendLog && doneNo != null) {
          stepOutcome.set(doneNo, ev.result?.isdone ? 'succeed' : 'failed')
          if (a.logAll || runFailed) writeBucket(doneNo, stepOutcome.get(doneNo)!)
          curStep = RUN_BUCKET
        }
        newSteps = reduceSteps(newSteps, ev)
      } else if (ev.event === 'step_log') {
        const heard = (ev.data as { lang_detected?: { lang?: string } } | undefined)?.lang_detected?.lang   // Detect mode: the language the user was heard in
        if (typeof heard === 'string') { h.heard = heard; set(key, { heardLang: heard }); if (live()) setVoiceLang(heard) }
        newSteps = reduceSteps(newSteps, ev)
        if (ev.log_image_reset && !ev.log_image) set(key, { logImage: null })
        if (ev.log_image) {
          set(key, { logImage: ev.log_image })
          // Frontend logging: save the per-step debug image alongside the
          // dataset captures (skipped while a failed-only run still looks fine).
          // Buffered like the captures so it carries the same verdict suffix.
          if (frontendLog) bucket({ kind: 'image', b64: ev.log_image }, ev.step ?? curStep)
        }
      } else if (ev.event === 'done' || ev.event === 'error') {
        ev.elapsed_ms = Date.now() - runStart
        endRec(key, (runFailed || ev.event === 'error') ? 'failed' : 'succeed')
        // Write the run summary next to the captures (all runs, or failures only).
        const runOutcome: Outcome =
          (runFailed || ev.event === 'error') ? 'failed' : 'succeed'
        if (frontendLog && (a.logAll || runFailed)) {
          writeRest(runOutcome)
          saveRunSummary(dir(), {
            task: a.finalPrompt,
            planner: a.direct ? 'direct' : a.planner,
            failed: runFailed || ev.event === 'error',
            elapsed_ms: ev.elapsed_ms,
            captures: dsSeq,
            failure_events: newEvents.filter(isFailureEvent),
            events: newEvents.map(e => ({ ...e, log_image: undefined, dataset: undefined })),
          }, runOutcome)
        }
        // Decide whether to chain another iteration.
        const ok = ev.event === 'done' &&
          (ev.status != null ? (ev.status === 'success' || ev.status === 'planned') : ev.success === true)
        const ctrl = h.repeat
        ctrl.remaining -= 1
        if (ctrl.active && ctrl.remaining > 0 && (ok || ctrl.continueOnError)) {
          setTimeout(() => { if (h.repeat.active) fireRef.current(key) }, 0)
        } else {
          ctrl.active = false
          applyAt(key, (st, k) => endRun(st, k, verdictOf(ev), Date.now()))
        }
      }

      emit(key, newEvents, newSteps)
    }

    // Only finalize on socket teardown when the loop isn't chaining a next run.
    // (a socket that is no longer the run's — replaced by a new run or dropped by Reset — must not end the new run)
    const gone = () => {
      if (h.ws !== ws) return
      stopNudge(h)
      // closed between two iterations of a repeat (the run's `done` was already seen): the next one is about to start.
      // Closed anywhere else = the run ended or was lost: (before 2026-11-12 an active repeat kept `running` true forever
      // after a dropped socket, Stop being the only way out)
      const between = get(key).run.phase === 'idle' && h.repeat.active
      dispatch(key, { t: 'ws-close' })
      if (between) return
      h.repeat.active = false
      applyAt(key, (st, k) => (st.sessions[k]?.running ? endRun(st, k, lostVerdict(st.sessions[k].seq, h.stopReq), Date.now()) : st))   // a socket closing after its `done` keeps that verdict; a plan of a sequence lost to the network is an error (Retry / Skip), not a Stop
      endRec(key)
    }
    ws.onclose = gone
    ws.onerror = gone
  }, [get, put, set, apply, applyAt, sess.stable, dispatch, H, shownKey, emit, noteOwnEvent, speak, beginRecording, endRecording, setRecordingPrefix])
  useEffect(() => { fireRef.current = fire }, [fire])

  const run = useCallback((finalPrompt: string, direct: boolean, lang = 'en', planner: 'grace' | 'direct' | 'sage' = 'grace', planOnly = false, logData = false, logTarget: 'backend' | 'frontend' = 'frontend', repeatTimes = 1, continueOnError = false, logAll = true, voice = true, screenRec = true) => {
    if (!finalPrompt.trim()) return
    const key = shownKey(), h = H(key)       // the run belongs to the robot on screen, whatever is picked later
    const keepSeq = h.seqKeep                 // set by runPreset / seqGo for the plan of a sequence, for this one call only
    h.seqKeep = false
    const why = startBlock(getStore(), key)   // one client per robot (rule 7): a busy robot takes no second command from this tab
    if (why) { addQaLine(key, 'system', why); return }
    if (!keepSeq) apply(st => patch(st, key, { seq: SEQ_IDLE }))   // a plain run (a button, the chat, a one-plan preset) ends a sequence that was waiting
    h.fromChat = h.nextFromChat
    h.nextFromChat = false
    const tok = sess.stable(key)      // a rename while the permission prompt is open must not lose the line
    // A run that will listen through this browser (qa / ask / reply, unless on
    // the robot mic or typed): get the mic permission now, inside the click.
    // SAGE may ask the user a question (which shelf? where are you?) through the same `ask` skill.
    if ((/\b(qa|ask|reply)\b/.test(finalPrompt) || (!direct && planner === 'sage'))
        && !/source\s*=\s*['"]robot/.test(finalPrompt)
        && !/input\s*=\s*['"]text/.test(finalPrompt)) {
      primeMic().then(err => {
        if (!err) return
        const why = err === 'insecure-context'
          ? 'this page is on http — open it over https (or localhost) to use the mic'
          : `microphone not available (${err}) — allow it in the browser's site settings`
        addQaLine(tok, 'robot', `🎤 ${why}; the robot will ask for typed input instead`)
        if (h.fromChat && sameKey(shownKey(), tok)) setChatOpen(true)
      })
    }
    loadSpeechRate()                  // Global Configs may have changed since the page loaded
    h.args = { finalPrompt, direct, lang, planner, planOnly, logData, logTarget, logAll, voice, screenRec }
    h.repeat = { remaining: repeatTimes, continueOnError, active: true }
    h.langs = robotLangsRef.current   // this run speaks with the languages of its own robot
    apply(st => beginRun(st, key, get(key).url || api.getAgentUrl(), Date.now()))   // freezes the url; fire() bumps the trial to 1
    fire(key)
  }, [get, apply, H, shownKey, getStore, fire, loadSpeechRate])

  // A preset is a SEQUENCE of plans (split at `---` lines; docs/features/plan-sequence.md): the first plan runs now, each next one when the operator
  // clicks Next on the bar. Every plan goes through run() like a plain plan. One plan (no `---`): exactly the old single run.
  const runPreset = useCallback((text: string, direct: boolean, lang = 'en', planner: 'grace' | 'direct' | 'sage' = 'grace', planOnly = false, logData = false, logTarget: 'backend' | 'frontend' = 'frontend', repeatTimes = 1, continueOnError = false, logAll = true) => {
    const plans = splitPlans(text)
    if (!isSequence(plans)) return run(text, direct, lang, planner, planOnly, logData, logTarget, repeatTimes, continueOnError, logAll)
    const key = shownKey(), h = H(key)
    const why = startBlock(getStore(), key)
    if (why) { addQaLine(key, 'system', why); return }
    const times = Number.isFinite(repeatTimes) ? repeatTimes : 1   // `forever` would never get past plan 1: in a sequence each plan runs once
    apply(st => patch(st, key, { seq: seqStart(plans) }))
    h.seqKeep = true
    h.seqRepeat = { times, coe: continueOnError }
    run(plans[0], direct, lang, planner, planOnly, logData, logTarget, times, continueOnError, logAll)
  }, [run, shownKey, H, getStore, apply])

  // The bar's clicks: Next / Retry run a plan with the options of the run before it; Skip and Stop only change the state.
  const seqGo = useCallback((f: typeof seqNext) => {
    const key = shownKey(), h = H(key), a = h.args, cur = get(key).seq
    const nxt = f(cur)
    if (nxt === cur || nxt.kind !== 'running' || !a) return
    const why = startBlock(getStore(), key)                 // a busy robot takes no command: the bar keeps its state
    if (why) { addQaLine(key, 'system', why); return }
    apply(st => patch(st, key, { seq: nxt }))
    h.seqKeep = true
    run(nxt.plans[nxt.index], a.direct, a.lang, a.planner, a.planOnly, a.logData, a.logTarget, h.seqRepeat.times, h.seqRepeat.coe, a.logAll, a.voice, a.screenRec)
  }, [shownKey, H, get, getStore, apply, run])
  const seqSkipClick = useCallback(() => { const key = shownKey(); apply(st => patch(st, key, { seq: seqSkip(get(key).seq) })) }, [shownKey, apply, get])
  const seqStopClick = useCallback(() => { const key = shownKey(); apply(st => patch(st, key, { seq: SEQ_IDLE })) }, [shownKey, apply])

  // End every capture in flight for the run: typed wait, mic recording, recogniser, speech, on-screen choice.
  // The mic and the speaker are the browser's one: only the robot on screen may end them.
  const abortCaptures = useCallback((key: SessionKey) => {
    H(key).textAsk?.(null)
    set(key, { choice: null })
    if (!sameKey(shownKey(), key)) return
    if (micMayEnd(micOwnerRef.current, key, sameKey)) { stopRecording(); abortRecognition() }   // one mic: only its owner ends it
    try { window.speechSynthesis.cancel() } catch { /* not supported */ }
  }, [H, set, shownKey, sameKey])

  // Hard reset of ONE session: always works, whatever the backend does (stuck in an LLM call, socket dead, cancel not answered).
  // Cancels (best effort, at the session's own robot), drops the run's socket, every pending listen, the HRI queue and the plan view; the chat is idle
  // with the input enabled. The 🎤 toggle keeps what the user set (the hands-free loop reads the live state, so no
  // listener stays attached to the dead run).
  const reset = useCallback((key: SessionKey, why = 'reset') => {
    const h = H(key)
    h.repeat.active = false
    stopNudge(h)
    h.stopReq = true
    api.cancelRunAt(get(key).url).catch(() => {})
    const ws = h.ws
    h.ws = null
    if (ws) { ws.onmessage = null; ws.onclose = null; ws.onerror = null; try { ws.close() } catch { /* closed */ } }
    abortCaptures(key)
    newHriEpoch(h)
    apply(st => endRun(patch(st, key, { events: [], steps: [], logImage: null }), key, 'aborted', Date.now()))
    endRec(key)
    dispatch(key, { t: 'reset' })
    h.stopReq = false
    if (sameKey(shownKey(), key)) setMicListening(false)
    addQaLine(key, 'system', `■ ${why}: the run was dropped on this side (cancel sent); you can type a new task`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [get, apply, dispatch, H, shownKey, abortCaptures])

  // Stop: tell the backend to cancel and wait for its `done` (the card shows "stopping…"; after STOP_TIMEOUT_MS it offers
  // Force reset). Pressed again while stuck, it is a Force reset. The socket stays open so the end of the run is seen.
  const stop = useCallback((key: SessionKey) => {
    const cur = get(key).run, h = H(key)
    if (stopAction(cur) === 'force-reset') { reset(key, 'force reset'); return }
    h.repeat.active = false   // cancel any pending repeat
    stopNudge(h)
    h.stopReq = true
    abortCaptures(key)
    dispatch(key, { t: 'stop' })
    // The backend runs the plan in its own thread, so the robot must be told to cancel explicitly (closing the socket alone
    // does not reach it). The url is the session's own, never "the robot picked now".
    api.cancelRunAt(get(key).url).then(() => dispatch(key, { t: 'cancel-ack' })).catch(() => {})
    if (!cur.ws) { apply(st => endRun(st, key, 'aborted', Date.now())); endRec(key) }
  }, [get, apply, dispatch, H, abortCaptures, reset])
  // Stop of the robot on screen (every Stop / Cancel button of a robot calls it). Cancel adds the Fleet tab: there it is the fleet's Stop all
  const stopShown = useCallback(() => { const t = cancelTarget(getStore()); if (t) stop(t.key) }, [getStore, stop])
  const cancel = useCallback(() => { if (mainTab === 'fleet' && fleetStopRef.current) fleetStopRef.current(); else stopShown() }, [mainTab, stopShown])
  const cancelTitle = mainTab === 'fleet' ? FLEET_STOP_HINT : 'Cancel every command in flight on the robot (arm, lift, head, base) and end the run'

  // A `qa` skill is running (its qa_state events) — as a step of a Structured plan: the "End Q&A" button ends
  // just that conversation, the plan goes on.
  const endQa = useCallback(() => {
    api.endQaAt(get(shownKey()).url).catch(e => alert(`End Q&A: ${e instanceof Error ? e.message : e}`))
  }, [get, shownKey])
  // One language for everything (chat and Structured runs): picked in the chat header or the control bar.
  // The languages come from the connected robot's manifest (GET /robot/languages): the picker's options, and the default
  // of a tab that has not chosen (or whose choice this robot does not talk in).
  const [robotLangs, setRobotLangs] = useRobotLanguages()
  const robotEpoch = useRobotEpoch()   // goes up when another robot is picked: the camera and map panels are rebuilt for it (key below)
  const [poseList, refreshPoses] = usePoses()           // the "Go to" poses the operator edits
  const [recorder, refreshRecorder] = useRecorder()   // raw VLA episode recording (none on most robots: nothing is drawn)
  const [teleopFns, refreshTeleop] = useTeleop()   // the robot's teleop functions (none on most robots: nothing is drawn)
  const dataBusy = recorder?.state?.state === 'recording' || recorder?.state?.state === 'saving' || teleopFns.some(f => f.state?.state === 'active' || f.state?.state === 'hold')
  const showDataTools = dataTools || dataBusy
  robotLangsRef.current = robotLangs
  const [lang, setLang]         = useState<Lang>('en')
  const [chatOpen, setChatOpen] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)   // the Guide dialog; opened from the ⋯ menu of the presets bar
  const [cameraSlot, setCameraSlot] = useState<HTMLElement | null>(null)   // the Cameras tab row's room for the camera chips (CameraFeed portals into it)
  // Chat settings: the planner (SAGE + assist by default) and plan-only (default ON, kept in localStorage)
  const [planner, setPlanner]   = useState<PlannerMethod>(DEFAULT_PLANNER)
  const [planOnly, setPlanOnly] = useState(true)
  const [handsFree, setHandsFree] = useState(false)
  handsFreeRef.current = handsFree
  const [micSupported, setMicSupported] = useState(false)
  const [micListening, setMicListening] = useState(false)
  const [micError, setMicError] = useState('')
  useEffect(() => {
    try {
      const pm = readTabPref(LS_PLANNER)
      if (pm === 'grace' || pm === 'direct' || pm === 'sage') setPlanner(pm)
    } catch { /* no storage */ }
    setPlanOnly(storedPlanOnly())
    pinTabPref(LS_PLANNER, storedPlanner())
    pinTabPref(LS_PLAN_ONLY, storedPlanOnly() ? '1' : '0')
    setMicSupported(!!(window.SpeechRecognition || window.webkitSpeechRecognition))
  }, [])
  useEffect(() => {
    const l = resolveLanguage(readTabPref('robotapp_lang', 'robotapp_qa_lang'), robotLangs)   // this tab's own choice, else the last one chosen in any tab, else the robot's default
    setLang(l)
    if (robotLangs && languageOptions(robotLangs, '').includes(l)) pinTabPref('robotapp_lang', l)   // this tab keeps what it started with
  }, [robotLangs])
  const pickLang = (v: Lang) => {
    setLang(v)
    writeTabPref('robotapp_lang', v)
  }
  const langPicker = (
    <LanguagePicker value={lang} options={languageOptions(robotLangs, lang)} detected={heardLang}
      supported={supportedLanguages(robotLangs)} on={robotLangs?.languages ?? []}
      disabled={running} buttonClass={PICK} onPick={pickLang}
      onToggle={async c => {
        const next = robotLangs ? toggleLanguage(robotLangs, c) : null
        if (!next) return 'at least one language must stay on'
        const err = await setRobotLangs(next)
        if (!err && lang === c && !next.includes(c)) pickLang(LANG_AUTO)   // the one in use was switched off
        return err
      }} />
  )
  const pickPlanner = (v: PlannerMethod) => {
    setPlanner(v)
    writeTabPref(LS_PLANNER, v)
    window.dispatchEvent(new CustomEvent(PLANNER_EVENT, { detail: v }))   // the Planner prompt panel follows
  }
  const pickPlanOnly = (v: boolean) => {
    setPlanOnly(v)
    writeTabPref(LS_PLAN_ONLY, v ? '1' : '0')
  }
  const chatSt = rs.phase

  // A chat message. Waiting (the robot asked): it is the ANSWER, through POST /agent/listen/<id> like a
  // spoken one, and it ends the capture in progress (mic recording / recogniser / typed wait). Idle: it
  // starts a NEW RUN of the text as an unstructured command with the chosen planner. Running and not
  // asked: nothing (the card's input is disabled then).
  const fleetMode = !!fl.active && mainTab === 'fleet'                  // the chat talks to the fleet (lib/useFleetChat.ts)
  const fleetChat = useFleetChat(fleetMode, l => {                      // the fleet's lines: a bubble, and spoken like a single robot's (🔊), so the mic can answer
    addQaLine(null, l.who, l.text, l.kind)
    if (l.who === 'robot' && voiceOutRef.current) speak(l.text, l.lang, rateFor(l.lang))
  }, lang === LANG_AUTO ? undefined : lang)
  const sendChat = useCallback((raw: string) => {
    const text = raw.trim()
    if (!text) return
    if (fleetMode) { addQaLine(null, 'user', text); void fleetChat.send(text); return }
    const key = shownKey(), cur = get(key), h = H(key), id = cur.listenId
    if (cur.running && id) {
      addQaLine(key, 'user', text)
      h.choiceAt = Date.now()   // a listen queued before this is answered: no prompt, no mic
      endMic(key)
      h.textAsk?.(null)
      if (voiceOutRef.current) { try { window.speechSynthesis.cancel() } catch { /* not supported */ } }
      takeListen(key, null)
      api.answerListenAt(cur.url, id, text).catch(() => {})
      return
    }
    if (cur.running) return
    addQaLine(key, 'user', text)
    let logData = true, logTarget: 'backend' | 'frontend' = 'frontend', logAll = false
    try {
      logData = localStorage.getItem('robotapp_log_data') !== '0'
      const lt = localStorage.getItem('robotapp_log_target'); if (lt === 'backend' || lt === 'frontend') logTarget = lt
      logAll = localStorage.getItem('robotapp_log_all') === '1'
    } catch { /* no storage */ }
    h.nextFromChat = true
    run(text, false, lang, planner, planOnly, logData, logTarget, 1, false, logAll, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, lang, planner, planOnly, fleetMode, fleetChat])
  const sendChatRef = useRef(sendChat); sendChatRef.current = sendChat

  // Hands-free: one-shot recognitions, only while idle and silent (lib/chatMic.ts, lib/useHandsFree.ts)
  useHandsFree({
    enabled: handsFree && micSupported, lang: speechLanguage(lang, robotLangs, heardLang),
    snapshot: () => ({
      running: get(shownKey()).running,
      waiting: get(shownKey()).listenId !== null,
      speaking: handsFreeBusy(micOwnerRef.current, shownKey(), sameKey, H(shownKey()), Date.now())
        || (typeof window !== 'undefined' && 'speechSynthesis' in window && (window.speechSynthesis.speaking || window.speechSynthesis.pending)),
    }),
    guard: echoGuard,
    onHeard: t => sendChatRef.current(t),
    onError: why => { setHandsFree(false); setMicError(`mic off: ${why}`) },
    onListening: setMicListening,
  })
  const toggleHandsFree = async (on: boolean) => {
    setMicError('')
    if (!on) { setHandsFree(false); return }
    const err = await primeMic()      // inside the click: the permission prompt can show (echo cancellation on)
    if (err) { setMicError(err === 'insecure-context' ? 'mic needs https or localhost' : `mic not available (${err})`); return }
    setHandsFree(true)
  }

  // Latest backend vision-capture dir (emitted when log_data=backend) — shown in the panel.
  const backendLogDir = agentEvents.reduce((acc, e) => e.log_dir || acc, '')
  const marks = statusMap(sess.store)                        // robots with a session that is not idle: the running mark of both drop-downs
  const blockWhy = startBlock(sess.store, sess.shown.key)    // why this robot takes no second command from this tab (rule 7)

  const chatPanel = (docked: boolean) => (
        <ChatPanel
          docked={docked}
          log={fleetMode ? fleetLog : qaLog}
          blockedWhy={fleetMode ? null : blockWhy}
          state={fleetMode ? 'idle' : chatSt}
          langPicker={langPicker}
          planner={planner} onPlanner={pickPlanner}
          planOnly={planOnly} onPlanOnly={pickPlanOnly}
          handsFree={handsFree} onHandsFree={v => { void toggleHandsFree(v) }}
          micSupported={micSupported} micListening={micListening}
          micNote={micError || (handsFree && chatSt !== 'idle' ? 'mic paused while the robot works' : '')}
          onSend={sendChat}
          onStop={fleetMode ? cancel : stopShown}
          onReset={() => reset(shownKey(), 'reset')}
          canStop={fleetMode || canStop(rs)} canType={fleetMode || canType(rs)} lost={!fleetMode && isLost(rs)} stuck={!fleetMode && needsForce(rs)}
          onClear={() => { if (fleetMode) setFleetLog([]); else set(shownKey(), { qaLog: [] }) }}
          onClose={() => setChatOpen(false)}
        />
  )

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">

        {/* Sidebar 1 — connections + skills */}
        <aside className={`relative flex-shrink-0 border-r border-gray-200 flex flex-col bg-white transition-all duration-200 ${sidebarOpen ? 'w-80' : 'w-0'}`}>
          <div className={`flex flex-col overflow-y-auto h-full ${sidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'} transition-opacity duration-150`}>
            <div className="p-4 border-b border-gray-200">
              <DevicePanel marks={marks} switchRef={switchRobotRef} onClientsChange={setClients} onAgentConnect={() => setSkillRefreshKey(k => k + 1)} onActiveChange={setTarget} onFleetChosen={() => { setMainTab('fleet'); setFleetKey(k => k + 1); setChatOpen(true) }} />
            </div>
            <div className="p-4 border-t border-gray-200">
              <SkillPanel refreshKey={skillRefreshKey} />
            </div>
            <div className="p-4 border-t border-gray-200">
              <EnvPanel refreshKey={skillRefreshKey} />
            </div>
            <div className="p-4 border-t border-gray-200">
              <PlannerPromptPanel refreshKey={skillRefreshKey} />
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(o => !o)}
            className="absolute -right-3 top-4 z-10 w-6 h-6 rounded-full bg-white border border-gray-300 shadow-sm flex items-center justify-center text-gray-500 hover:text-gray-800 hover:border-gray-400 text-[10px]"
          >
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </aside>

        {/* Sidebar 2 — buttons + plan + execution. w-72 (2026-10-27, was w-96): 5 shortcut buttons per row */}
        <aside className={`relative flex-shrink-0 border-r border-gray-200 flex flex-col bg-white transition-all duration-200 ${planOpen ? 'w-72' : 'w-0'}`}>
          <div className={`flex flex-col h-full overflow-hidden ${planOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'} transition-opacity duration-150`}>
            {/* Control bar: Cancel, language, Chat — right above the shortcut buttons (2026-10-21). Cancel is
                also kept on the Cameras / Map tab row, so it stays reachable with this column collapsed. */}
            {/* one row in the w-72 column (2026-10-27): smaller Cancel / Chat, the pickers without their native ▾
                (appearance-none — each keeps its title), wrapping only when ⏹ End Q&A is added */}
            <div className="px-3 pt-3 pb-2 border-b border-gray-200 flex-shrink-0 flex flex-wrap items-center gap-1">
              <button onClick={cancel}
                title={cancelTitle}
                className="px-2 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs font-semibold rounded shadow-sm whitespace-nowrap">
                {rs.phase === 'stopping' ? stopLabel(rs, '■ Cancel') : '■ Cancel'}
              </button>
              {qaSkill && (
                <button onClick={endQa}
                  title="End Q&A: end the conversation as if the user said 그만 — the robot says goodbye, qa succeeds and the plan goes on"
                  className="px-2 py-1.5 bg-gray-600 hover:bg-gray-500 text-white text-xs rounded">
                  ⏹
                </button>
              )}
              <span className="ml-auto">{langPicker}</span>
              <button onClick={() => setChatOpen(o => !o)}
                title={listenId && !chatOpen ? 'The robot is waiting for your answer: open the chat to type it' : 'Chat with the robot: give it a task in words, answer when it asks (type or speak)'}
                data-testid="chat-button" data-waiting={listenId && !chatOpen ? '1' : undefined}
                className={`px-1.5 py-1.5 text-xs rounded text-white whitespace-nowrap ${listenId && !chatOpen ? 'bg-amber-500 hover:bg-amber-400 animate-pulse' : chatSt !== 'idle' && chatOpen ? 'bg-emerald-600 hover:bg-emerald-500 animate-pulse' : 'bg-indigo-600 hover:bg-indigo-500'}`}>
                💬 Chat{listenId && !chatOpen ? ' ●' : ''}
              </button>
            </div>
            <div className="p-3 border-b border-gray-200 flex-shrink-0">
              {/* Button-panel shortcuts run silently — no voice announcements. */}
              <ButtonPanel
                onRun={plan => run(plan, true, 'en', 'grace', false, false, 'frontend', 1, false, true, false, false)}   // a button: no data log, no voice, no screen recording
                refreshKey={skillRefreshKey} />
            </div>
            <div className="p-4 flex-1 overflow-y-auto">
              {blockWhy && !fleetMode && <div data-testid="start-block" className="mb-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">{blockWhy}</div>}
              <ForeignRunBadge run={foreignRun} />
              {!fleetMode && <SequenceBar seq={seq} lost={isLost(rs)} onNext={() => seqGo(seqNext)} onRetry={() => seqGo(seqRetry)} onSkip={seqSkipClick} onStop={() => { if (barGuard(isLost(rs)).stopCancelsRun) stopShown(); seqStopClick() }} />}
              <PlanPanel events={agentEvents} steps={agentSteps} planMethod={runMethod} running={running || (!!foreignRun && !foreignRun.ended)} />
            </div>
          </div>
          <button
            onClick={() => setPlanOpen(o => !o)}
            className="absolute -right-3 top-4 z-10 w-6 h-6 rounded-full bg-white border border-gray-300 shadow-sm flex items-center justify-center text-gray-500 hover:text-gray-800 hover:border-gray-400 text-[10px]"
          >
            {planOpen ? '◀' : '▶'}
          </button>
        </aside>

        {/* Main area — agent + camera */}
        <main className="flex-1 flex flex-col overflow-y-auto">

          <section className="px-5 pt-2 pb-1 border-b border-gray-200">
            <AgentPanel toolbarExtra={<>
          <label
            title={voiceSupported ? 'Sound in this browser: milestones, the robot\'s lines (announce / ask / qa), earcons, alarm. Off = silent (the lines still show in the chat)' : 'Browser does not support speech synthesis'}
            className={`flex items-center gap-1 text-xs cursor-pointer whitespace-nowrap ${voiceSupported ? 'text-gray-600' : 'text-gray-300 cursor-not-allowed'}`}>
            <input type="checkbox" checked={voiceOut} disabled={!voiceSupported}
              onChange={e => setVoiceOut(e.target.checked)} className="accent-blue-600" />
            🔊 voice
          </label>
          {voiceOut && voiceMissing && (
            <span className="text-[10px] text-amber-600"
              title={`No ${voiceLang} voice is installed — speech falls back to another voice and will sound wrong. Install the language's TTS voice in your OS settings.`}>
              ⚠ no {voiceLang} voice
            </span>
          )}
          </>} onOpenGuide={() => setGuideOpen(true)} running={running} lang={lang} onRun={runPreset} onStop={stopShown} stopText={stopLabel(rs)} recordEnabled={recordEnabled} onToggleRecord={toggleRecord} manualRecording={manualRecording} onToggleManualRecord={toggleManualRecord} backendLogDir={backendLogDir} trial={trial} />
          </section>
          <GuidePanel open={guideOpen} onOpenChange={setGuideOpen} hideTrigger />

          <section className="px-5 pt-1 pb-3">
            <div className="flex gap-1 mb-2 pb-1 border-b border-gray-200 items-center">
              {/* Cameras | Map as a two-icon switch (was two text tabs, about 120 px; now about 56 px) */}
              <div role="tablist" className="flex shrink-0 rounded overflow-hidden border border-gray-300 text-sm self-center">
                {(recorder ? ['cameras', 'map', 'data'] as const : ['cameras', 'map'] as const).map(t => (
                  <button key={t} role="tab" aria-selected={mainTab === t} onClick={() => setMainTab(t)}
                          aria-label={t === 'cameras' ? 'Cameras' : t === 'map' ? 'Map' : 'Data'} title={t === 'cameras' ? 'Cameras' : t === 'map' ? 'Map' : 'Data: the recorded episodes'}
                          className={`px-2 py-0.5 leading-none ${mainTab === t ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-100'}`}>
                    {t === 'cameras' ? '📷' : t === 'map' ? '🗺️' : '🗂️'}
                  </button>
                ))}
              </div>
              {(teleopFns.length > 0 || recorder) && (() => {
                return (
                  <button data-testid="data-tools-toggle" onClick={toggleDataTools} disabled={dataBusy} aria-pressed={showDataTools}
                    aria-label="Make data: remote control and record" title={dataBusy ? 'In use: remote control or a recording is running' : showDataTools ? 'Hide remote control and record' : 'Make data: show remote control and record'}
                    className={`self-center px-2 py-0.5 leading-none rounded border text-sm ${showDataTools ? 'bg-red-50 border-red-300 text-red-600' : 'bg-white border-gray-300 text-gray-400 hover:bg-gray-100'} disabled:cursor-default`}>⏺</button>
                )
              })()}
              {/* which robot or fleet this tab drives (two tabs may drive two robots): one drop-down for both. A fleet opens the Fleet view
                  (there is no Fleet tab button); a robot leaves it. With a fleet chosen but another tab open, the drop-down shows the fleet as
                  its placeholder, and picking the fleet again returns to the Fleet view. */}
              {(fl.active || target?.robot || robotList.length > 0 || fl.fleets.length > 0) && (() => {
                const badges = target?.robot && !fl.active ? targetBadges(target.robot, target.location) : null
                const value = fl.active ? (mainTab === 'fleet' ? `fleet:${fl.active}` : '') : target?.robot ? `robot:${target.robot}` : ''
                return (
                  <span className="self-center ml-2 flex items-center gap-1 text-xs text-gray-600 min-w-0"
                    title={fl.active ? 'The fleet this tab drives: pick a fleet or a robot' : target?.robot ? targetTitle(target.robot, target.location, target.url, target.host) : 'Pick a robot or a fleet'}>
                    <select data-testid="fleet-switch" aria-label="robot or fleet" value={value}
                      onFocus={readRobotList} onMouseDown={readRobotList}
                      onChange={e => {
                        const s = parseSelection(e.target.value)
                        if (s?.kind === 'fleet') fl.choose(s.name)                                   // opens the Fleet view
                        else if (s) { fl.clear(); if (mainTab === 'fleet') setMainTab('cameras'); void switchRobotRef.current?.(s.name) }
                      }}
                      className="px-1.5 py-0.5 rounded bg-gray-100 border border-gray-200 font-medium text-xs truncate max-w-[12rem]">
                      {value === '' && <option value="">{fl.active ? `👥 ${fl.active}` : '(choose)'}</option>}
                      {(['Fleets', 'Robots'] as const).map(g => {
                        const opts = selectorOptions(robotList, fl.fleets).filter(o => o.group === g)
                        return opts.length > 0 && <optgroup key={g} label={g}>{opts.map(o => <option key={o.value} value={o.value}>{optionText(o.label, marks[o.value] ?? 'idle', g === 'Fleets' ? '👥 ' : '🤖 ')}</option>)}</optgroup>
                      })}
                    </select>
                    {badges?.mismatch && badges.location && (
                      <span className="px-1 py-0.5 rounded bg-amber-50 border border-amber-300 text-amber-600 leading-none"
                        title={mismatchTitle(badges.robot, badges.location)}>⚠</span>
                    )}
                  </span>
                )
              })()}
              {/* the camera chips (CameraFeed's Tab | Grid and one chip per view) are drawn here, on this row */}
              <div ref={setCameraSlot} className="flex-1 min-w-0 flex items-center self-center ml-3 overflow-x-auto" />
              {/* Always live, unlike the Agent panel's Stop: a skill run from the
                  CLI or another client can be moving the robot while this tab
                  shows nothing running. */}
              <button onClick={cancel}
                title={cancelTitle}
                className={`ml-2 self-center px-3 py-1 bg-red-600 hover:bg-red-500 text-white text-xs rounded shrink-0`}>
                {stopLabel(rs, 'Cancel')}
              </button>
            </div>
            {mainTab === 'cameras' && showDataTools && <TeleopBar functions={teleopFns} runInFlight={running} onChanged={refreshTeleop} poses={poseList} onPosesChanged={refreshPoses} />}
            {mainTab === 'cameras' && showDataTools && <RecorderBar status={recorder} runInFlight={running} onChanged={() => { refreshRecorder(); refreshTeleop() }} poses={poseList} />}
            {mainTab === 'cameras'
              ? <CameraFeed key={`cam-${robotEpoch}`} clients={clients} logImage={logImage} onClearLog={() => set(shownKey(), { logImage: null })} toolbarSlot={cameraSlot} />
              : mainTab === 'fleet' ? <><FleetPanel key={fleetKey} toolbarSlot={cameraSlot} stopRef={fleetStopRef} />{chatOpen && fleetMode && chatPanel(true)}</>
              : mainTab === 'data' && recorder ? <DataPanel key={`data-${robotEpoch}`} /> : <MapPanel key={`map-${robotEpoch}`} clients={clients} running={running} onStop={stopShown} />}
          </section>

        </main>
      </div>
      {choice && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl p-5 w-full max-w-md flex flex-col gap-3">
            <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
              The robot did not understand the answer and is waiting — click the user&apos;s choice.
            </div>
            {choice.prompt && <div className="text-base font-medium text-gray-800 break-words">{choice.prompt}</div>}
            <div className="grid grid-cols-2 gap-2">
              {choice.options.map(o => (
                <button key={o} onClick={() => pickChoice(o)}
                  className="px-3 py-3 text-base bg-blue-600 hover:bg-blue-500 text-white rounded break-words">
                  {o}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      {chatOpen && !fleetMode && chatPanel(false)}
    </div>
  )
}
