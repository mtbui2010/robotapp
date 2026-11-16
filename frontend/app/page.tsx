'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import DevicePanel, { type ActiveTarget } from '../components/DevicePanel'
import AgentPanel   from '../components/AgentPanel'
import CameraFeed   from '../components/CameraFeed'
import TeleopBar    from '../components/TeleopBar'
import RecorderBar  from '../components/RecorderBar'
import DataPanel    from '../components/DataPanel'
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
import { api }      from '../lib/api'
import { useVoiceOutput, stillWorkingPhrase } from '../lib/useVoiceOutput'
import { speakAndWait, recognizeOnce, recordPhrase, primeMic, playEarcon, playAlarm, stopRecording, abortRecognition } from '../lib/hriVoice'
import { answerBy, createEchoGuard } from '../lib/chatMic'
import { useHandsFree } from '../lib/useHandsFree'
import { INITIAL_RUN, STOP_TIMEOUT_MS, noteForListenReply, stopAction, stopLabel, runReduce, canStop, canType, isLost, needsForce, type RunEvent, type RunState } from '../lib/chatRun'
import { LS_PLANNER, PLANNER_EVENT, DEFAULT_PLANNER, LS_PLAN_ONLY, storedPlanOnly, storedPlanner, type PlannerMethod } from '../lib/planner'
import { useScreenRecorder } from '../lib/useScreenRecorder'
import { saveDataset, saveRunSummary, runFolder } from '../lib/datasetLog'
import type { Outcome } from '../lib/datasetLog'
import { pinTabPref, readTabPref, writeTabPref } from '../lib/tabPref'
import type { ClientEntry, AgentEvent, Lang } from '../lib/types'
import { useRobotLanguages } from '../lib/useRobotLanguages'
import { mismatchTitle, targetBadges, targetTitle } from '../lib/targetBadge'
import { resolveLanguage, languageOptions, speechLanguage, supportedLanguages, toggleLanguage, LANG_AUTO, type RobotLanguages } from '../lib/robotLanguages'
import LanguagePicker from '../components/LanguagePicker'
import type { Step } from '../components/PlanPanel'

// Filename-safe prefix from a task string, e.g. 'find::apple' → 'find_apple'.
const sanitizeTask = (t: string): string =>
  (t || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'task'

// Sequentially download a base64 JPEG to the browser Downloads folder.
const downloadJpeg = (b64: string, name: string): void => {
  const a = document.createElement('a')
  a.href = `data:image/jpeg;base64,${b64}`
  a.download = name
  document.body.appendChild(a); a.click(); a.remove()
}

// Mirrors the backend's failure test (unified_agent._is_failure_event): a step
// returning isdone False, a run-level error, or a GRACE symbolic violation.
const isFailureEvent = (ev: AgentEvent): boolean => {
  if (ev.event === 'error') return true
  if (ev.event === 'step_done') {
    if (ev.status === 'failed') return true
    if (ev.result && (ev.result as { isdone?: unknown }).isdone === false) return true
  }
  if (ev.event === 'done') {
    return ev.status != null ? !(ev.status === 'success' || ev.status === 'planned') : ev.success === false
  }
  if (ev.event === 'plan_step' && ev.phase === 'verified' && ev.ok === false) return true
  if (ev.event === 'plan_step' && Array.isArray(ev.violations) && ev.violations.length > 0) return true
  if (ev.event === 'replan') return true
  return false
}

// Control-bar pickers (KO / 🎤 / 📷 / 🔁): no native ▾, so the bar fits one row of the w-72 column
const PICK = 'appearance-none text-center text-xs border border-gray-300 rounded px-1 py-1 bg-white hover:border-gray-400 cursor-pointer disabled:opacity-50'

export default function Home() {
  const [clients, setClients]         = useState<ClientEntry[]>([])
  const [skillRefreshKey, setSkillRefreshKey] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(false)   // collapsed by default (2026-10-27); ▶ opens it
  const [planOpen, setPlanOpen]       = useState(true)
  const [mainTab, setMainTab]         = useState<'cameras' | 'map' | 'data'>('cameras')
  // Remote control + Record are only used to make data: hidden until the operator asks (kept in this browser); never hidden while recording or while teleop drives the arm
  const [dataTools, setDataTools]       = useState(false)
  useEffect(() => { try { setDataTools(localStorage.getItem('robotapp_data_tools') === '1') } catch { /* off */ } }, [])
  const toggleDataTools = () => setDataTools(v => { try { localStorage.setItem('robotapp_data_tools', v ? '0' : '1') } catch { /* per-viewer convenience */ } return !v })
  const [target, setTarget]           = useState<ActiveTarget | null>(null)   // robot + site this tab drives
  const [running, setRunning]         = useState(false)
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([])
  const [agentSteps, setAgentSteps]   = useState<Step[]>([])
  const [logImage, setLogImage]       = useState<string | null>(null)
  const [runMethod, setRunMethod]     = useState('')   // 'grace' | 'direct' | 'sage' — planner used by the active run
  const [trial, setTrial]             = useState(0)    // current iteration number while looping
  const [voiceOut, setVoiceOut]       = useState(true)   // speak milestones by default
  // 🔊 off = no sound at all (2026-10-27): milestones, and also the skills' own lines (announce / ask / qa
  // `speak`, a listen's prompt), the earcons and the alarm — read live, so unticking mid-run silences the rest
  const voiceOutRef = useRef(voiceOut)
  voiceOutRef.current = voiceOut
  const [voiceLang, setVoiceLang]     = useState('en')
  const wsRef     = useRef<WebSocket | null>(null)
  const eventsRef = useRef<AgentEvent[]>([])
  const stepsRef  = useRef<Step[]>([])
  const runStartRef = useRef<number>(0)

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

  const emit = useCallback((events: AgentEvent[], steps: Step[]) => {
    eventsRef.current = events
    stepsRef.current  = steps
    setAgentEvents(events)
    setAgentSteps(steps)
  }, [])

  // Repeat controller: run the same plan N times / forever. `remaining` may be
  // Infinity (forever); `active` gates chaining and is cleared by Stop.
  const repeatRef = useRef<{ remaining: number; continueOnError: boolean; active: boolean }>(
    { remaining: 1, continueOnError: false, active: false }
  )
  const argsRef = useRef<{ finalPrompt: string; direct: boolean; lang: string; planner: 'grace' | 'direct' | 'sage'; planOnly: boolean; logData: boolean; logTarget: 'backend' | 'frontend'; logAll: boolean; voice: boolean } | null>(null)
  const robotLangsRef = useRef<RobotLanguages | null>(null)   // the robot's languages, for the speech language of a Detect run
  const heardLangRef = useRef<string | null>(null)             // the language heard last in a Detect run
  const runLang = (l: string) => speechLanguage(l, robotLangsRef.current, heardLangRef.current)
  // "Still working" nudge: while a step runs without new milestones, repeat a
  // short phrase so a long-running task doesn't sound stalled.
  const nudgeRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // The chat log (what the robot said / asked and what the user said or typed), and the pending
  // typed answer: an input='text' listen waits on this resolver until the chat sends a line
  // (or the run stops — then it resolves null and nothing is posted).
  const [qaLog, setQaLog] = useState<ChatLine[]>([])
  const textAskRef = useRef<((text: string | null) => void) | null>(null)
  // The robot asked: the id of the pending `listen` (a message in the chat is its answer), in any input mode
  const [listenId, setListenId] = useState<string | null>(null)
  const listenIdRef = useRef<string | null>(null)
  // Life cycle of the run for the chat (idle / running / waiting / stopping + "a run may still be alive"): lib/chatRun.ts
  const [rs, setRs] = useState<RunState>(INITIAL_RUN)
  const rsRef = useRef<RunState>(INITIAL_RUN)
  const sendRun = useCallback((e: RunEvent) => { rsRef.current = runReduce(rsRef.current, e); setRs(rsRef.current) }, [])
  const takeListen = (id: string | null) => {
    listenIdRef.current = id; setListenId(id)
    sendRun({ t: id ? 'listen' : 'answered' })
  }
  const runningRef = useRef(false)
  // Stop was pressed for the run in flight: its late `speak` / `listen` events are ignored and its capture jobs do not post
  const stopReqRef = useRef(false)
  // HRI queue (speak / listen / alarm jobs, strictly in order). A new run and a Reset start a new EPOCH: jobs of an
  // older epoch that have not started are dropped and cannot hold the queue.
  const hriEpochRef = useRef(0)
  const hriChainRef = useRef<Promise<void>>(Promise.resolve())
  const newHriEpoch = () => { hriEpochRef.current++; hriChainRef.current = Promise.resolve(); hriBusyRef.current = 0; speechUntilRef.current = 0 }
  // Only a run started from the chat card may open it; a Structured run never does (the Chat button pulses instead)
  const nextRunChatRef = useRef(false)
  const runFromChatRef = useRef(false)
  const handsFreeRef = useRef(false)    // the chat's mic toggle, read by the listen handler (set below, from state)
  // Robot speech for the hands-free mic: HRI jobs queued (set by fire), and the time until which a line the
  // robot said (the browser or its own speaker, which we cannot hear end) is assumed to still be playing.
  const hriBusyRef = useRef(0)
  const speechUntilRef = useRef(0)
  const echoGuard = useRef(createEchoGuard()).current
  // a line the robot says: robot bubble (even with 🔊 off), echo guard, speech-time estimate for the mic
  const addQaLine = (who: ChatLine['who'], text: string, kind?: ChatLine['kind']) => {
    if (who === 'robot') {
      echoGuard.note(text, Date.now())
      speechUntilRef.current = Math.max(speechUntilRef.current, Date.now() + 400 + 90 * text.length)
    }
    setQaLog(l => {
      const last = l[l.length - 1]
      return who === 'robot' && last && last.who === 'robot' && last.text === text ? l : [...l, { who, text, ...(kind ? { kind } : {}) }]
    })
  }
  // The user's spoken answer shows at once as "🎤 …" (in order, right after the question) and becomes the transcript when the speech
  // server returns it (or is removed when there is none): without it the line appeared only after the robot had already moved on.
  const HEARD_PENDING = '🎤 …'
  const settleHeard = (text: string | null) => setQaLog(l => {
    const i = l.map(x => x.who === 'user' && x.text === HEARD_PENDING).lastIndexOf(true)
    if (i < 0) return l
    const n = l.slice()
    if (text) n[i] = { ...n[i], text }; else n.splice(i, 1)
    return n
  })
  // kcare ask did not understand: its options as buttons (a helper clicks; the user is blind)
  const [choice, setChoice] = useState<{ id: string; options: string[]; prompt: string } | null>(null)
  // When the last click came: a listen queued before it is answered by the click — its prompt is cut and its mic
  // not opened (2026-10-27: a click while the robot was still asking was acted on only after the whole question
  // and a full listen window — recordPhrase starts with the stop flag cleared).
  const choiceAtRef = useRef(0)
  const pickChoice = (opt: string) => {
    if (!choice) return
    const id = choice.id
    setChoice(null)
    choiceAtRef.current = Date.now()
    stopRecording()                     // the click answers: end the recording in progress
    textAskRef.current?.(null)          // or the typed answer being waited for
    if (voiceOutRef.current) { try { window.speechSynthesis.cancel() } catch { /* not supported */ } }  // and the question
    addQaLine('user', `${opt} (화면 선택)`)
    takeListen(null)
    api.answerListen(id, opt).catch(() => {})
  }
  const stopNudge = useCallback(() => {
    if (nudgeRef.current) { clearInterval(nudgeRef.current); nudgeRef.current = null }
  }, [])
  useEffect(() => stopNudge, [stopNudge])   // never leave a timer running
  const fireRef = useRef<() => void>(() => {})
  const enqueueHri = (job: () => Promise<void>) => {
    const ep = hriEpochRef.current
    hriBusyRef.current++
    hriChainRef.current = hriChainRef.current.then(() => ep === hriEpochRef.current ? job() : undefined).catch(() => {}).finally(() => {
      if (ep !== hriEpochRef.current) return          // a Reset / new run zeroed the counter
      hriBusyRef.current--
      speechUntilRef.current = Math.max(speechUntilRef.current, Date.now())   // spoken to the end just now
    })
  }

  // One WS run of the current args. On completion it either chains the next
  // iteration (repeat) or finalizes (setRunning false).
  const fire = useCallback(() => {
    const a = argsRef.current
    if (!a) return
    setTrial(t => t + 1)            // count this iteration
    wsRef.current?.close()
    emit([], [])
    heardLangRef.current = null
    setHeardLang(null)
    setVoiceLang(runLang(a.lang))
    runStartRef.current = Date.now()
    setRecordingPrefix('')          // reset; set from the first step's task below
    // Planner actually used: structured/explicit plans run directly; otherwise
    // it's the chosen planner ('grace' | 'direct').
    setRunMethod(a.direct ? 'direct' : (a.planner ?? 'grace'))
    beginRecording()                // no-op unless screen recording is enabled

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
    newHriEpoch()
    stopReqRef.current = false
    sendRun({ t: 'start' })
    const epoch = hriEpochRef.current
    const aborted = () => hriEpochRef.current !== epoch || stopReqRef.current   // Stop / Reset since this run began
    // Stop a milestone that is already playing, just before the browser speaks
    // for the skill (a phrase queued before the HRI event still runs).
    // Not with 🔊 off: nothing of ours is playing then (unticking cancelled it), and a cancel here can cut the
    // speech of ANOTHER dashboard window on the same computer (2026-10-27: a muted window running qa — a cancel
    // before every listen — silenced the other window's lines).
    const silenceNarration = () => {
      if (!voiceOutRef.current) return
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

    const ws = api.agentWs()
    wsRef.current = ws

    ws.onopen = () => ws.send(JSON.stringify({
      prompt: a.finalPrompt, lang: a.lang, direct: a.direct, planner: a.planner,
      plan_only: a.planOnly, log_data: a.logData,
      log_mode: a.logTarget, log_all: a.logAll,
    }))

    ws.onmessage = e => {
      const ev: AgentEvent = JSON.parse(e.data)
      ev._rx = Date.now()                  // receive time: the plan list shows step durations from it
      const newEvents = [...eventsRef.current, ev]
      let newSteps = stepsRef.current

      // Speak the milestone phrase on the dashboard (no-op if voice output is
      // off, or for Button-panel shortcuts which run silently). Each milestone
      // also restarts the "still working" nudge, so it only fires when a step
      // goes quiet for a while.
      // BACKEND-WORKAROUND(hri-narrator-gate): no narration while an HRI speak / listen is queued
      if (ev.say && ev.event !== 'done' && ev.event !== 'error') addQaLine('robot', ev.say, 'say')
      if (a.voice && ev.say && hriBusyRef.current === 0) {
        speak(ev.say, ev.say_lang, rateFor(ev.say_lang ?? runLang(a.lang)))
        stopNudge()
        if (ev.event !== 'done' && ev.event !== 'error') {
          const nudgeLang = ev.say_lang ?? runLang(a.lang)      // "still working" in the language of the last phrase
          nudgeRef.current = setInterval(() => speak(stillWorkingPhrase(nudgeLang), nudgeLang, rateFor(nudgeLang)), 15_000)
        }
      } else if (a.voice && ev.say && voiceOutRef.current) {
        // The HRI queue is still talking (ask's read-back "…, 알겠습니다" is not
        // waited for, so the next step starts right away): this milestone used to
        // be dropped ("가운데 선반 이동…" after ask was never said). Say it after
        // the queue, in order — still never while the mic is open.
        const line = ev.say
        stopNudge()
        const lineLang = ev.say_lang ?? runLang(a.lang)
        enqueueHri(async () => { if (voiceOutRef.current) await speakAndWait(line, lineLang, rateFor(lineLang)) })
      }
      if (ev.qa_state) setQaSkill(!!ev.qa_state.active)
      if (ev.choose) setChoice({ id: ev.choose.id, options: ev.choose.options, prompt: ev.choose.prompt ?? '' })
      if (ev.choose_close) {
        const closed = ev.choose_close
        setChoice(c => (c && c.id === closed ? null : c))
      }
      if (ev.event === 'clarify' && ev.question) addQaLine('robot', String(ev.question))
      if (ev.event === 'done' || ev.event === 'error') {
        const okEnd = ev.event === 'done' && (ev.status != null ? (ev.status === 'success' || ev.status === 'planned') : ev.success === true)
        setQaLog(l => [...l, { who: 'system', text: ev.event === 'error' ? `✗ error: ${ev.msg ?? ''}`
          : okEnd ? (ev.status === 'planned' ? '✓ planned (plan only: the robot did not move)' : '✓ done') + (ev.msg ? ` — ${ev.msg}` : '')
          : `✗ failed${ev.msg ? ` — ${ev.msg}` : ''}` }])
        setChoice(null)
        setQaSkill(false)
        stopNudge()
        sendRun({ t: 'done' })
        textAskRef.current?.(null)          // a typed question can no longer be asked
      }

      // A skill is talking to the user through this browser. The "still
      // working" nudge must not speak over it — or into the open mic.
      if (ev.speak || ev.listen || ev.alarm || ev.quiet) stopNudge()
      if (ev.speak && !aborted()) {
        const line = ev.speak
        const lang = ev.speak_lang ?? runLang(a.lang)
        const rate = ev.speak_rate ?? rateFor(lang)
        addQaLine('robot', line)
        const speakId = ev.speak_id
        enqueueHri(async () => {
          silenceNarration()
          if (voiceOutRef.current) await speakAndWait(line, lang, rate)
          // announce(wait=True): tell the skill the line has been spoken.
          if (speakId) await api.answerListen(speakId, '').catch(() => {})
        })
      }
      if (ev.alarm && !aborted()) {
        // A (simulated) 119 call: the siren, after the line before it and before the one after it.
        const al = ev.alarm
        enqueueHri(async () => {
          silenceNarration()
          if (voiceOutRef.current) await playAlarm(al.volume ?? 0.6, al.cycles ?? 3)
        })
      }
      if (ev.listen && !aborted()) {
        const req = ev.listen
        const lang = req.lang ?? runLang(a.lang)
        const rate = req.rate ?? rateFor(lang)
        if (req.prompt) addQaLine('robot', req.prompt)
        textAskRef.current?.(null)          // an older question still waiting for typing is superseded, it cannot hold the queue
        takeListen(req.id)
        if (runFromChatRef.current) setChatOpen(true)   // a chat run opens the card; a Structured run only pulses the Chat button
        const clearListen = () => { if (listenIdRef.current === req.id) takeListen(null) }
        const queuedAt = Date.now()
        const answeredByClick = () => aborted() || choiceAtRef.current >= queuedAt   // nothing to post: answered by a click, or stopped / reset
        // Typed answer: no mic. The chat's Send answers directly (sendChat); this wait only holds the queue, with no
        // timeout of its own (the backend decides when to give up; a newer question, Stop and Reset end it).
        const waitTyped = async () => {
          const typed = await new Promise<string | null>(resolve => { textAskRef.current = resolve })
          textAskRef.current = null
          if (typed !== null && !aborted()) await api.answerListen(req.id, typed).catch(() => {})
        }
        const listenJob = async () => {
          if (answeredByClick()) return
          silenceNarration()
          if (req.prompt && voiceOutRef.current) await speakAndWait(req.prompt, lang, rate)
          if (answeredByClick()) return
          if (answerBy({ runFromChat: runFromChatRef.current, micOn: handsFreeRef.current, listenMode: req.mode }) === 'typing') {
            // no mic: the backend asked for text, or this is a chat run with the chat's mic off
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
            const rec = await recordPhrase(req.max_sec ?? 8, req.silence_sec ?? 1.5)
            if (answeredByClick()) return            // typed / clicked meanwhile: that answer stands
            if (rec.error) {                  // e.g. not-allowed: the skill falls back to typing
              addQaLine('system', `⚠ microphone not available (${rec.error}): type your answer`)
              await api.answerListen(req.id, '', rec.error, rec.note).catch(() => {})
              return
            }
            if (rec.blob && ear > 0) playEarcon('heard', ear)
            if (rec.blob) addQaLine('user', HEARD_PENDING)
            const res = await api.answerListenAudio(req.id, rec.blob, rec.mime, rec.note)
            settleHeard(res.text || null)
            if (aborted()) return
            const goneNote = noteForListenReply(res)
            if (goneNote) { addQaLine('system', goneNote); return }
            if (res.error) {
              // The speech server failed (down, out of GPU memory, HTTP 5xx). The backend still waits for this listen:
              // say so, and keep the question open for a typed answer (input enabled) instead of treating it as silence.
              addQaLine('system', `⚠ speech recognition failed (${res.error}): type your answer`)
              await waitTyped()
              return
            }
            return
          }
          const heard = await recognizeOnce(lang, req.max_sec ?? 8)
          if (answeredByClick()) return              // typed / clicked meanwhile: that answer stands
          if (heard.text && echoGuard.isEcho(heard.text, Date.now())) {
            console.info('[hri] dropped a transcript that echoes the robot:', heard.text)
            heard.text = ''
          }
          if (heard.text && ear > 0) playEarcon('heard', ear)
          if (heard.text) addQaLine('user', heard.text)
          else if (heard.error) addQaLine('system', `⚠ microphone / speech recognition not available (${heard.error}): type your answer`)
          else if (heard.note) console.info('[hri] nothing recognised:', heard.note)
          await api.answerListen(req.id, heard.text, heard.error, heard.note).catch(() => {})
        }
        enqueueHri(() => listenJob().finally(clearListen))
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
          setRecordingPrefix(dir())
        }
        // SAGE events carry `index` / `action` / `object` instead of `step` / `total` / `task`
        const stepNo = ev.step ?? ev.index
        if (stepNo != null) curStep = stepNo
        newSteps = [...newSteps, {
          index: stepNo!,
          total: ev.total!,
          task: ev.task ?? [ev.action, ev.object].filter(Boolean).join(' '),
          status: 'running' as const,
          startedAt: Date.now(),
        }]
      } else if (ev.event === 'step_done') {
        const doneNo = ev.step ?? ev.index      // SAGE: `index`, reused after a recovery splice → the running row
        if (frontendLog && doneNo != null) {
          stepOutcome.set(doneNo, ev.result?.isdone ? 'succeed' : 'failed')
          if (a.logAll || runFailed) writeBucket(doneNo, stepOutcome.get(doneNo)!)
          curStep = RUN_BUCKET
        }
        let hit = -1
        newSteps.forEach((s, i) => { if (s.index === doneNo && s.status === 'running') hit = i })
        newSteps = newSteps.map((s, i) =>
          i === hit
            ? { ...s, status: (ev.result?.isdone ? 'done' : 'failed') as Step['status'], result: ev.result, endedAt: Date.now() }
            : s
        )
      } else if (ev.event === 'step_log') {
        const entry = { data: ev.data ?? {}, image: ev.log_image ?? undefined, ts: ev.ts ?? Date.now() / 1000 }
        const heard = (ev.data as { lang_detected?: { lang?: string } } | undefined)?.lang_detected?.lang   // Detect mode: the language the user was heard in
        if (typeof heard === 'string') { heardLangRef.current = heard; setHeardLang(heard); setVoiceLang(heard) }
        newSteps = newSteps.map(s =>
          s.index === ev.step ? { ...s, logs: [...(s.logs ?? []), entry] } : s
        )
        if (ev.log_image_reset && !ev.log_image) setLogImage(null)
        if (ev.log_image) {
          setLogImage(ev.log_image)
          // Frontend logging: save the per-step debug image alongside the
          // dataset captures (skipped while a failed-only run still looks fine).
          // Buffered like the captures so it carries the same verdict suffix.
          if (frontendLog) bucket({ kind: 'image', b64: ev.log_image }, ev.step ?? curStep)
        }
      } else if (ev.event === 'done' || ev.event === 'error') {
        ev.elapsed_ms = Date.now() - runStartRef.current
        endRecording((runFailed || ev.event === 'error') ? 'failed' : 'succeed')
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
        const ctrl = repeatRef.current
        ctrl.remaining -= 1
        if (ctrl.active && ctrl.remaining > 0 && (ok || ctrl.continueOnError)) {
          setTimeout(() => { if (repeatRef.current.active) fireRef.current() }, 0)
        } else {
          ctrl.active = false
          setRunning(false)
        }
      }

      emit(newEvents, newSteps)
    }

    // Only finalize on socket teardown when the loop isn't chaining a next run.
    // (a socket that is no longer the run's — replaced by a new run or dropped by Reset — must not end the new run)
    const gone = () => {
      if (wsRef.current !== ws) return
      stopNudge()
      // closed between two iterations of a repeat (the run's `done` was already seen): the next one is about to start.
      // Closed anywhere else = the run ended or was lost: (before 2026-11-12 an active repeat kept `running` true forever
      // after a dropped socket, Stop being the only way out)
      const between = rsRef.current.phase === 'idle' && repeatRef.current.active
      sendRun({ t: 'ws-close' })
      if (between) return
      repeatRef.current.active = false
      setRunning(false); endRecording()
    }
    ws.onclose = gone
    ws.onerror = gone
  }, [emit, speak, beginRecording, endRecording, setRecordingPrefix, stopNudge, sendRun])
  useEffect(() => { fireRef.current = fire }, [fire])

  const run = useCallback((finalPrompt: string, direct: boolean, lang = 'en', planner: 'grace' | 'direct' | 'sage' = 'grace', planOnly = false, logData = false, logTarget: 'backend' | 'frontend' = 'frontend', repeatTimes = 1, continueOnError = false, logAll = true, voice = true) => {
    if (!finalPrompt.trim() || running) return
    runFromChatRef.current = nextRunChatRef.current
    nextRunChatRef.current = false
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
        addQaLine('robot', `🎤 ${why}; the robot will ask for typed input instead`)
        if (runFromChatRef.current) setChatOpen(true)
      })
    }
    loadSpeechRate()                  // Global Configs may have changed since the page loaded
    argsRef.current = { finalPrompt, direct, lang, planner, planOnly, logData, logTarget, logAll, voice }
    repeatRef.current = { remaining: repeatTimes, continueOnError, active: true }
    setTrial(0)                     // fire() bumps it to 1
    setRunning(true)
    fire()
  }, [running, fire, loadSpeechRate])

  // End every capture in flight for the run: typed wait, mic recording, recogniser, speech, on-screen choice
  const abortCaptures = useCallback(() => {
    textAskRef.current?.(null)
    stopRecording(); abortRecognition()
    try { window.speechSynthesis.cancel() } catch { /* not supported */ }
    setChoice(null)
  }, [])

  // Hard reset: always works, whatever the backend does (stuck in an LLM call, socket dead, cancel not answered).
  // Cancels (best effort), drops the run's socket, every pending listen, the HRI queue and the plan view; the chat is idle
  // with the input enabled. The 🎤 toggle keeps what the user set (the hands-free loop reads the live state, so no
  // listener stays attached to the dead run).
  const reset = useCallback((why = 'reset') => {
    repeatRef.current.active = false
    stopNudge()
    stopReqRef.current = true
    api.cancelRun().catch(() => {})
    const ws = wsRef.current
    wsRef.current = null
    if (ws) { ws.onmessage = null; ws.onclose = null; ws.onerror = null; try { ws.close() } catch { /* closed */ } }
    abortCaptures()
    newHriEpoch()
    takeListen(null)
    setQaSkill(false)
    emit([], [])
    setLogImage(null)
    setRunning(false)
    endRecording()
    sendRun({ t: 'reset' })
    stopReqRef.current = false
    setMicListening(false)
    addQaLine('system', `■ ${why}: the run was dropped on this side (cancel sent); you can type a new task`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emit, endRecording, stopNudge, abortCaptures, sendRun])

  // Stop: tell the backend to cancel and wait for its `done` (the card shows "stopping…"; after STOP_TIMEOUT_MS it offers
  // Force reset). Pressed again while stuck, it is a Force reset. The socket stays open so the end of the run is seen.
  const stop = useCallback(() => {
    const cur = rsRef.current
    if (stopAction(cur) === 'force-reset') { reset('force reset'); return }
    repeatRef.current.active = false   // cancel any pending repeat
    stopNudge()
    stopReqRef.current = true
    abortCaptures()
    sendRun({ t: 'stop' })
    // The backend runs the plan in its own thread, so the robot must be told to cancel explicitly (closing the socket alone
    // does not reach it).
    api.cancelRun().then(() => sendRun({ t: 'cancel-ack' })).catch(() => {})
    if (!cur.ws) { setRunning(false); endRecording() }
  }, [endRecording, stopNudge, abortCaptures, sendRun, reset])
  useEffect(() => {
    if (rs.phase !== 'stopping') return
    const t = setTimeout(() => sendRun({ t: 'timeout' }), STOP_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [rs.phase, sendRun])

  // A `qa` skill is running (its qa_state events) — as a step of a Structured plan: the "End Q&A" button ends
  // just that conversation, the plan goes on.
  const [qaSkill, setQaSkill] = useState(false)
  const endQa = useCallback(() => {
    api.endQa().catch(e => alert(`End Q&A: ${e instanceof Error ? e.message : e}`))
  }, [])
  // One language for everything (chat and Structured runs): picked in the chat header or the control bar.
  // The languages come from the connected robot's manifest (GET /robot/languages): the picker's options, and the default
  // of a tab that has not chosen (or whose choice this robot does not talk in).
  const [robotLangs, setRobotLangs] = useRobotLanguages()
  const [poseList, refreshPoses] = usePoses()           // the "Go to" poses the operator edits
  const [recorder, refreshRecorder] = useRecorder()   // raw VLA episode recording (none on most robots: nothing is drawn)
  const [teleopFns, refreshTeleop] = useTeleop()   // the robot's teleop functions (none on most robots: nothing is drawn)
  const dataBusy = recorder?.state?.state === 'recording' || recorder?.state?.state === 'saving' || teleopFns.some(f => f.state?.state === 'active' || f.state?.state === 'hold')
  const showDataTools = dataTools || dataBusy
  robotLangsRef.current = robotLangs
  const [heardLang, setHeardLang] = useState<string | null>(null)         // Detect: the language heard last in this run
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
  useEffect(() => {
    runningRef.current = running
    if (!running) { listenIdRef.current = null; setListenId(null); setQaSkill(false) }
  }, [running])
  const chatSt = rs.phase

  // A chat message. Waiting (the robot asked): it is the ANSWER, through POST /agent/listen/<id> like a
  // spoken one, and it ends the capture in progress (mic recording / recogniser / typed wait). Idle: it
  // starts a NEW RUN of the text as an unstructured command with the chosen planner. Running and not
  // asked: nothing (the card's input is disabled then).
  const sendChat = useCallback((raw: string) => {
    const text = raw.trim()
    if (!text) return
    const id = listenIdRef.current
    if (runningRef.current && id) {
      addQaLine('user', text)
      choiceAtRef.current = Date.now()   // a listen queued before this is answered: no prompt, no mic
      stopRecording(); abortRecognition()
      textAskRef.current?.(null)
      if (voiceOutRef.current) { try { window.speechSynthesis.cancel() } catch { /* not supported */ } }
      takeListen(null)
      api.answerListen(id, text).catch(() => {})
      return
    }
    if (runningRef.current) return
    addQaLine('user', text)
    let logData = true, logTarget: 'backend' | 'frontend' = 'frontend', logAll = false
    try {
      logData = localStorage.getItem('robotapp_log_data') !== '0'
      const lt = localStorage.getItem('robotapp_log_target'); if (lt === 'backend' || lt === 'frontend') logTarget = lt
      logAll = localStorage.getItem('robotapp_log_all') === '1'
    } catch { /* no storage */ }
    nextRunChatRef.current = true
    run(text, false, lang, planner, planOnly, logData, logTarget, 1, false, logAll, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, lang, planner, planOnly])
  const sendChatRef = useRef(sendChat); sendChatRef.current = sendChat

  // Hands-free: one-shot recognitions, only while idle and silent (lib/chatMic.ts, lib/useHandsFree.ts)
  useHandsFree({
    enabled: handsFree && micSupported, lang: speechLanguage(lang, robotLangs, heardLang),
    snapshot: () => ({
      running: runningRef.current,
      waiting: listenIdRef.current !== null,
      speaking: hriBusyRef.current > 0 || Date.now() < speechUntilRef.current
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

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">

        {/* Sidebar 1 — connections + skills */}
        <aside className={`relative flex-shrink-0 border-r border-gray-200 flex flex-col bg-white transition-all duration-200 ${sidebarOpen ? 'w-80' : 'w-0'}`}>
          <div className={`flex flex-col overflow-y-auto h-full ${sidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'} transition-opacity duration-150`}>
            <div className="p-4 border-b border-gray-200">
              <DevicePanel onClientsChange={setClients} onAgentConnect={() => setSkillRefreshKey(k => k + 1)} onActiveChange={setTarget} />
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
              <button onClick={stop}
                title="Cancel every command in flight on the robot (arm, lift, head, base) and end the run"
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
                onRun={plan => run(plan, true, 'en', 'grace', false, false, 'frontend', 1, false, true, false)}
                refreshKey={skillRefreshKey} />
            </div>
            <div className="p-4 flex-1 overflow-y-auto">
              <PlanPanel events={agentEvents} steps={agentSteps} planMethod={runMethod} running={running} />
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
          </>} onOpenGuide={() => setGuideOpen(true)} running={running} lang={lang} onRun={run} onStop={stop} stopText={stopLabel(rs)} recordEnabled={recordEnabled} onToggleRecord={toggleRecord} manualRecording={manualRecording} onToggleManualRecord={toggleManualRecord} backendLogDir={backendLogDir} trial={trial} />
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
              {/* which robot and site this tab drives (two tabs may drive two robots) */}
              {target?.robot && (() => {
                const badges = targetBadges(target.robot, target.location)
                return (
                  <span className="self-center ml-2 flex items-center gap-1 text-xs text-gray-600 min-w-0"
                    title={targetTitle(target.robot, target.location, target.url, target.host)}>
                    <span className="px-1.5 py-0.5 rounded bg-gray-100 border border-gray-200 font-medium truncate max-w-[9rem]">🤖 {badges.robot}</span>
                    {badges.mismatch && badges.location && (
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
              <button onClick={stop}
                title="Cancel every command in flight on the robot (arm, lift, head, base) and end the run"
                className={`ml-2 self-center px-3 py-1 bg-red-600 hover:bg-red-500 text-white text-xs rounded shrink-0`}>
                {stopLabel(rs, 'Cancel')}
              </button>
            </div>
            {mainTab === 'cameras' && showDataTools && <TeleopBar functions={teleopFns} runInFlight={running} onChanged={refreshTeleop} poses={poseList} onPosesChanged={refreshPoses} />}
            {mainTab === 'cameras' && showDataTools && <RecorderBar status={recorder} runInFlight={running} onChanged={() => { refreshRecorder(); refreshTeleop() }} />}
            {mainTab === 'cameras'
              ? <CameraFeed clients={clients} logImage={logImage} onClearLog={() => setLogImage(null)} toolbarSlot={cameraSlot} />
              : mainTab === 'data' && recorder ? <DataPanel /> : <MapPanel clients={clients} running={running} />}
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
      {chatOpen && (
        <ChatPanel
          log={qaLog}
          state={chatSt}
          langPicker={langPicker}
          planner={planner} onPlanner={pickPlanner}
          planOnly={planOnly} onPlanOnly={pickPlanOnly}
          handsFree={handsFree} onHandsFree={v => { void toggleHandsFree(v) }}
          micSupported={micSupported} micListening={micListening}
          micNote={micError || (handsFree && chatSt !== 'idle' ? 'mic paused while the robot works' : '')}
          onSend={sendChat}
          onStop={stop}
          onReset={() => reset('reset')}
          canStop={canStop(rs)} canType={canType(rs)} lost={isLost(rs)} stuck={needsForce(rs)}
          onClear={() => setQaLog([])}
          onClose={() => setChatOpen(false)}
        />
      )}
    </div>
  )
}
