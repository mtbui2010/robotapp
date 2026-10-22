'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import DevicePanel  from '../components/DevicePanel'
import AgentPanel   from '../components/AgentPanel'
import CameraFeed   from '../components/CameraFeed'
import SkillPanel   from '../components/SkillPanel'
import EnvPanel     from '../components/EnvPanel'
import MapPanel     from '../components/MapPanel'
import GuideEditorPanel from '../components/GuideEditorPanel'
import GuidePanel   from '../components/GuidePanel'
import PlanPanel    from '../components/PlanPanel'
import ButtonPanel  from '../components/ButtonPanel'
import QaChat, { type QaLine } from '../components/QaChat'
import { api }      from '../lib/api'
import { useVoiceOutput, stillWorkingPhrase } from '../lib/useVoiceOutput'
import { speakAndWait, recognizeOnce, recordPhrase, primeMic, playEarcon, playAlarm, stopRecording } from '../lib/hriVoice'
import { useScreenRecorder } from '../lib/useScreenRecorder'
import { saveDataset, saveRunSummary, runFolder } from '../lib/datasetLog'
import type { Outcome } from '../lib/datasetLog'
import type { ClientEntry, AgentEvent, Lang } from '../lib/types'
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

export default function Home() {
  const [clients, setClients]         = useState<ClientEntry[]>([])
  const [skillRefreshKey, setSkillRefreshKey] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [planOpen, setPlanOpen]       = useState(true)
  const [mainTab, setMainTab]         = useState<'cameras' | 'map'>('cameras')
  const [running, setRunning]         = useState(false)
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([])
  const [agentSteps, setAgentSteps]   = useState<Step[]>([])
  const [logImage, setLogImage]       = useState<string | null>(null)
  const [runMethod, setRunMethod]     = useState('')   // 'grace' | 'direct' | 'sage' — planner used by the active run
  const [trial, setTrial]             = useState(0)    // current iteration number while looping
  const [voiceOut, setVoiceOut]       = useState(true)   // speak milestones by default
  const [voiceLang, setVoiceLang]     = useState('en')
  const wsRef     = useRef<WebSocket | null>(null)
  const eventsRef = useRef<AgentEvent[]>([])
  const stepsRef  = useRef<Step[]>([])
  const runStartRef = useRef<number>(0)

  // How fast the browser speaks: the robot's HRI_CONFIGS.speech_rate (Global Configs), read on mount and at
  // every run; a speak / listen event's own rate (HRI_CONFIGS at that moment, or a call's rate=) wins for that line.
  const [speechRate, setSpeechRate] = useState<number | undefined>(undefined)
  const speechRateRef = useRef<number | undefined>(undefined)
  const takeRate = useCallback((r: unknown) => {
    const n = Number(r)
    if (!(n > 0) || n === speechRateRef.current) return
    speechRateRef.current = n
    setSpeechRate(n)
  }, [])
  const loadSpeechRate = useCallback(() => {
    api.getSkillConfig('HRI_CONFIGS').then(c => { if (c) takeRate(c.speech_rate) }).catch(() => {})
  }, [takeRate])
  useEffect(() => { loadSpeechRate() }, [loadSpeechRate])

  // Dashboard voice output — speaks each event's `say` (robot also speaks via backend).
  const { speak, supported: voiceSupported, missingVoice: voiceMissing } = useVoiceOutput({ enabled: voiceOut, lang: voiceLang, rate: speechRate })
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
  // "Still working" nudge: while a step runs without new milestones, repeat a
  // short phrase so a long-running task doesn't sound stalled.
  const nudgeRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // HRI conversation shown in the Q&A card, and the pending typed answer: an
  // input='text' listen waits on this resolver until the user sends a line
  // (or the run stops — then it resolves null and nothing is posted).
  const [qaLog, setQaLog] = useState<QaLine[]>([])
  const [textWaiting, setTextWaiting] = useState(false)
  // A skill asked for typed input in this run — from the Q&A button, from
  // `qa::input='text'` typed in the Agent panel, or after the browser refused
  // the mic (hri falls back to text). The Q&A card then shows its input box.
  const [textListen, setTextListen] = useState(false)
  const textAskRef = useRef<((text: string | null) => void) | null>(null)
  const addQaLine = (who: QaLine['who'], text: string) => setQaLog(l => [...l, { who, text }])
  // kcare ask did not understand: its options as buttons (a helper clicks; the user is blind)
  const [choice, setChoice] = useState<{ id: string; options: string[]; prompt: string } | null>(null)
  const pickChoice = (opt: string) => {
    if (!choice) return
    const id = choice.id
    setChoice(null)
    stopRecording()                     // the click answers: end the recording in progress
    addQaLine('user', `${opt} (화면 선택)`)
    api.answerListen(id, opt).catch(() => {})
  }
  const stopNudge = useCallback(() => {
    if (nudgeRef.current) { clearInterval(nudgeRef.current); nudgeRef.current = null }
  }, [])
  useEffect(() => stopNudge, [stopNudge])   // never leave a timer running
  const fireRef = useRef<() => void>(() => {})

  // One WS run of the current args. On completion it either chains the next
  // iteration (repeat) or finalizes (setRunning false).
  const fire = useCallback(() => {
    const a = argsRef.current
    if (!a) return
    setTrial(t => t + 1)            // count this iteration
    wsRef.current?.close()
    emit([], [])
    setVoiceLang(a.lang)
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

    // HRI skills (source='dashboard'): speak and listen strictly in the order
    // the skill asked, so the mic never opens while the browser is still
    // talking — it would transcribe the robot's own question.
    let hri: Promise<void> = Promise.resolve()
    // Milestones are narrated by useVoiceOutput, which speaks outside this
    // queue: without this counter a `plan_ready` / `step_start` phrase plays
    // while the mic is open and comes back as the user's answer, and its
    // speechSynthesis.cancel() can cut the skill's own question mid-sentence.
    let hriPending = 0
    const enqueueHri = (job: () => Promise<void>) => {
      hriPending++
      hri = hri.then(job).catch(() => {}).finally(() => { hriPending-- })
    }
    // Stop a milestone that is already playing, just before the browser speaks
    // for the skill (a phrase queued before the HRI event still runs).
    const silenceNarration = () => {
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
      const newEvents = [...eventsRef.current, ev]
      let newSteps = stepsRef.current

      // Speak the milestone phrase on the dashboard (no-op if voice output is
      // off, or for Button-panel shortcuts which run silently). Each milestone
      // also restarts the "still working" nudge, so it only fires when a step
      // goes quiet for a while.
      if (a.voice && ev.say && hriPending === 0) {
        speak(ev.say)
        stopNudge()
        if (ev.event !== 'done' && ev.event !== 'error') {
          nudgeRef.current = setInterval(() => speak(stillWorkingPhrase(a.lang)), 15_000)
        }
      } else if (a.voice && ev.say) {
        // The HRI queue is still talking (ask's read-back "…, 알겠습니다" is not
        // waited for, so the next step starts right away): this milestone used to
        // be dropped ("가운데 선반 이동…" after ask was never said). Say it after
        // the queue, in order — still never while the mic is open.
        const line = ev.say
        stopNudge()
        enqueueHri(() => speakAndWait(line, a.lang, speechRateRef.current))
      }
      if (ev.qa_state) setQaSkill(!!ev.qa_state.active)
      if (ev.choose) setChoice({ id: ev.choose.id, options: ev.choose.options, prompt: ev.choose.prompt ?? '' })
      if (ev.choose_close) {
        const closed = ev.choose_close
        setChoice(c => (c && c.id === closed ? null : c))
      }
      if (ev.event === 'done' || ev.event === 'error') {
        setChoice(null)
        setQaSkill(false)
        stopNudge()
        textAskRef.current?.(null)          // a typed question can no longer be asked
      }

      // A skill is talking to the user through this browser. The "still
      // working" nudge must not speak over it — or into the open mic.
      if (ev.speak || ev.listen || ev.alarm) stopNudge()
      if (ev.speak) {
        const line = ev.speak
        const lang = ev.speak_lang ?? a.lang
        const rate = ev.speak_rate ?? speechRateRef.current
        addQaLine('robot', line)
        const speakId = ev.speak_id
        enqueueHri(async () => {
          silenceNarration()
          await speakAndWait(line, lang, rate)
          // announce(wait=True): tell the skill the line has been spoken.
          if (speakId) await api.answerListen(speakId, '').catch(() => {})
        })
      }
      if (ev.alarm) {
        // A (simulated) 119 call: the siren, after the line before it and before the one after it.
        const al = ev.alarm
        enqueueHri(async () => {
          silenceNarration()
          await playAlarm(al.volume ?? 0.6, al.cycles ?? 3)
        })
      }
      if (ev.listen) {
        const req = ev.listen
        const lang = req.lang ?? a.lang
        const rate = req.rate ?? speechRateRef.current
        if (req.prompt) addQaLine('robot', req.prompt)
        enqueueHri(async () => {
          silenceNarration()
          if (req.prompt) await speakAndWait(req.prompt, lang, rate)
          if (req.mode === 'text') {
            setTextListen(true)
            setChatOpen(true)
            // Typed answer: wait for the Q&A card's Send (no mic).
            const typed = await new Promise<string | null>(resolve => {
              textAskRef.current = resolve
              setTextWaiting(true)
            })
            textAskRef.current = null
            setTextWaiting(false)
            if (typed !== null) await api.answerListen(req.id, typed).catch(() => {})
            return
          }
          // "your turn": played to the end before the mic opens; "got it" once a phrase was taken
          const ear = req.earcon ?? 0
          if (ear > 0) {
            await playEarcon('listen', ear)
            await new Promise(r => setTimeout(r, 100))
          }
          if (req.capture === 'whisper') {
            // Record only; the robot transcribes it with Whisper (stt connection).
            const rec = await recordPhrase(req.max_sec ?? 8, req.silence_sec ?? 1.5)
            if (rec.error) {                  // e.g. not-allowed: the skill falls back to typing
              await api.answerListen(req.id, '', rec.error, rec.note).catch(() => {})
              return
            }
            if (rec.blob && ear > 0) playEarcon('heard', ear)
            const text = await api.answerListenAudio(req.id, rec.blob, rec.mime, rec.note).catch(() => '')
            if (text) addQaLine('user', text)
            return
          }
          const heard = await recognizeOnce(lang, req.max_sec ?? 8)
          if (heard.text && ear > 0) playEarcon('heard', ear)
          if (heard.text) addQaLine('user', heard.text)
          else if (heard.note) console.info('[hri] nothing recognised:', heard.note)
          await api.answerListen(req.id, heard.text, heard.error, heard.note).catch(() => {})
        })
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
        if (ev.step != null) curStep = ev.step
        newSteps = [...newSteps, {
          index: ev.step!,
          total: ev.total!,
          task: ev.task!,
          status: 'running' as const,
          startedAt: Date.now(),
        }]
      } else if (ev.event === 'step_done') {
        if (frontendLog && ev.step != null) {
          stepOutcome.set(ev.step, ev.result?.isdone ? 'succeed' : 'failed')
          if (a.logAll || runFailed) writeBucket(ev.step, stepOutcome.get(ev.step)!)
          curStep = RUN_BUCKET
        }
        newSteps = newSteps.map(s =>
          s.index === ev.step
            ? { ...s, status: (ev.result?.isdone ? 'done' : 'failed') as Step['status'], result: ev.result, endedAt: Date.now() }
            : s
        )
      } else if (ev.event === 'step_log') {
        const entry = { data: ev.data ?? {}, image: ev.log_image ?? undefined, ts: ev.ts ?? Date.now() / 1000 }
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
    ws.onclose = () => { stopNudge(); if (!repeatRef.current.active) { setRunning(false); endRecording() } }
    ws.onerror = () => { stopNudge(); if (!repeatRef.current.active) { setRunning(false); endRecording() } }
  }, [emit, speak, beginRecording, endRecording, setRecordingPrefix, stopNudge])
  useEffect(() => { fireRef.current = fire }, [fire])

  const run = useCallback((finalPrompt: string, direct: boolean, lang = 'en', planner: 'grace' | 'direct' | 'sage' = 'grace', planOnly = false, logData = false, logTarget: 'backend' | 'frontend' = 'frontend', repeatTimes = 1, continueOnError = false, logAll = true, voice = true) => {
    if (!finalPrompt.trim() || running) return
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
        setChatOpen(true)
      })
    }
    loadSpeechRate()                  // Global Configs may have changed since the page loaded
    argsRef.current = { finalPrompt, direct, lang, planner, planOnly, logData, logTarget, logAll, voice }
    repeatRef.current = { remaining: repeatTimes, continueOnError, active: true }
    setTrial(0)                     // fire() bumps it to 1
    setRunning(true)
    fire()
  }, [running, fire, loadSpeechRate])

  const stop = useCallback(() => {
    repeatRef.current.active = false   // cancel any pending repeat
    stopNudge()
    textAskRef.current?.(null)         // drop a typed question still being waited for
    // Closing the socket only stops the UI listening: the backend runs the plan
    // in its own thread, so the robot must be told to cancel explicitly. Sent
    // before the close so it also covers a skill still moving the arm.
    api.cancelRun().catch(() => {})
    wsRef.current?.close()
    setRunning(false)
    endRecording()
  }, [endRecording, stopNudge])

  // Visual Q&A: one press starts a `qa` conversation (browser mic, answers from
  // the head camera), the next press ends it through the same cancel as Stop,
  // which also releases the listen the skill is blocked on.
  const [qaActive, setQaActive] = useState(false)
  // A `qa` skill is running (its qa_state events) — in any run, also inside a
  // plan: the "End Q&A" button ends just that conversation, the plan goes on.
  const [qaSkill, setQaSkill] = useState(false)
  const endQa = useCallback(() => {
    api.endQa().catch(e => alert(`End Q&A: ${e instanceof Error ? e.message : e}`))
  }, [])
  // One language for everything (Agent panel runs and Q&A): picked in the
  // Agent panel, the only language selector.
  const [lang, setLang]         = useState<Lang>('ko')
  // Questions by voice (browser mic) or typed in the Q&A card.
  const [qaInput, setQaInput]   = useState<'voice' | 'text'>('voice')
  const [qaCam, setQaCam]       = useState<'head' | 'arm'>('head')
  const [qaOnce, setQaOnce]     = useState(false)     // one question, then end
  const [chatOpen, setChatOpen] = useState(false)
  useEffect(() => {
    try {
      const l = localStorage.getItem('robotapp_lang') ?? localStorage.getItem('robotapp_qa_lang')
      if (l === 'ko' || l === 'en') setLang(l)
      const m = localStorage.getItem('robotapp_qa_input'); if (m === 'voice' || m === 'text') setQaInput(m)
      const c = localStorage.getItem('robotapp_qa_cam'); if (c === 'head' || c === 'arm') setQaCam(c)
      setQaOnce(localStorage.getItem('robotapp_qa_once') === '1')
    } catch { /* no storage */ }
  }, [])
  const pickQaOnce = (v: boolean) => {
    setQaOnce(v)
    try { localStorage.setItem('robotapp_qa_once', v ? '1' : '0') } catch { /* no storage */ }
  }
  const pickQaCam = (v: 'head' | 'arm') => {
    setQaCam(v)
    try { localStorage.setItem('robotapp_qa_cam', v) } catch { /* no storage */ }
  }
  const pickQaInput = (v: 'voice' | 'text') => {
    setQaInput(v)
    try { localStorage.setItem('robotapp_qa_input', v) } catch { /* no storage */ }
  }
  const pickLang = (v: Lang) => {
    setLang(v)
    try { localStorage.setItem('robotapp_lang', v) } catch { /* no storage */ }
  }
  useEffect(() => { if (!running) { setQaActive(false); setTextListen(false); setQaSkill(false) } }, [running])
  const toggleQa = useCallback(() => {
    if (qaActive) { stop(); return }
    if (running) return
    setQaActive(true)
    setQaLog([])
    setChatOpen(true)
    // voice=false: milestone narration would only talk over the conversation.
    // The mic (robot / dashboard) comes from HRI_CONFIGS['source']; typing is
    // done on this page, so text mode names the dashboard.
    const cam = (qaCam === 'arm' ? ", cam='arm'" : '')      // head is the skill's default
              + (qaOnce ? ', once=True' : '')
    run(qaInput === 'text' ? `qa::source='dashboard', lang='${lang}', input='text'${cam}`
                           : `qa::lang='${lang}'${cam}`, true, lang, 'direct',
        false, false, 'frontend', 1, false, true, false)
  }, [qaActive, running, lang, qaInput, qaCam, qaOnce, run, stop])

  // Latest backend vision-capture dir (emitted when log_data=backend) — shown in the panel.
  const backendLogDir = agentEvents.reduce((acc, e) => e.log_dir || acc, '')

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">

      {/* Top bar */}
      <header className="border-b border-gray-200 px-5 py-3 flex items-center gap-3 bg-white shadow-sm">
        <span className="font-bold text-lg tracking-tight">RobotApp</span>
        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">v2</span>
        <span className="text-xs text-gray-400 ml-1">powered by robot_agent</span>
        <div className="ml-auto flex items-center gap-3">
          <label
            title={voiceSupported ? 'Read agent milestones aloud in the browser' : 'Browser does not support speech synthesis'}
            className={`flex items-center gap-1.5 text-xs cursor-pointer ${voiceSupported ? 'text-gray-600' : 'text-gray-300 cursor-not-allowed'}`}>
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
          <GuidePanel />
        </div>
      </header>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">

        {/* Sidebar 1 — connections + skills */}
        <aside className={`relative flex-shrink-0 border-r border-gray-200 flex flex-col bg-white transition-all duration-200 ${sidebarOpen ? 'w-80' : 'w-0'}`}>
          <div className={`flex flex-col overflow-y-auto h-full ${sidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'} transition-opacity duration-150`}>
            <div className="p-4 border-b border-gray-200">
              <DevicePanel onClientsChange={setClients} onAgentConnect={() => setSkillRefreshKey(k => k + 1)} />
            </div>
            <div className="p-4 border-t border-gray-200">
              <SkillPanel refreshKey={skillRefreshKey} />
            </div>
            <div className="p-4 border-t border-gray-200">
              <EnvPanel refreshKey={skillRefreshKey} />
            </div>
            <div className="p-4 border-t border-gray-200">
              <GuideEditorPanel refreshKey={skillRefreshKey} />
            </div>
          </div>
          <button
            onClick={() => setSidebarOpen(o => !o)}
            className="absolute -right-3 top-4 z-10 w-6 h-6 rounded-full bg-white border border-gray-300 shadow-sm flex items-center justify-center text-gray-500 hover:text-gray-800 hover:border-gray-400 text-[10px]"
          >
            {sidebarOpen ? '◀' : '▶'}
          </button>
        </aside>

        {/* Sidebar 2 — buttons + plan + execution */}
        <aside className={`relative flex-shrink-0 border-r border-gray-200 flex flex-col bg-white transition-all duration-200 ${planOpen ? 'w-96' : 'w-0'}`}>
          <div className={`flex flex-col h-full overflow-hidden ${planOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'} transition-opacity duration-150`}>
            {/* Control bar: Cancel, language, Q&A — right above the shortcut buttons (2026-10-21). Cancel is
                also kept on the Cameras / Map tab row, so it stays reachable with this column collapsed. */}
            <div className="px-3 pt-3 pb-2 border-b border-gray-200 flex-shrink-0 flex items-center gap-1">
              <button onClick={stop}
                title="Cancel every command in flight on the robot (arm, lift, head, base) and end the run"
                className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-sm font-semibold rounded shadow-sm">
                ■ Cancel
              </button>
              {qaSkill && (
                <button onClick={endQa}
                  title="End Q&A: end the conversation as if the user said 그만 — the robot says goodbye, qa succeeds and the plan goes on"
                  className="px-2 py-1.5 bg-gray-600 hover:bg-gray-500 text-white text-xs rounded">
                  ⏹
                </button>
              )}
              <select value={lang} onChange={e => pickLang(e.target.value as Lang)} disabled={qaActive}
                title="Language of the robot's speech and of what it hears — Agent runs and Q&A"
                className="ml-auto text-sm border border-gray-300 rounded px-0.5 py-0.5 bg-white disabled:opacity-50">
                <option value="ko">KO</option>
                <option value="en">EN</option>
              </select>
              <select value={qaInput} onChange={e => pickQaInput(e.target.value as 'voice' | 'text')} disabled={qaActive}
                title="Q&A by voice (🎤 browser mic) or by typing (⌨ in the Q&A card)"
                className="text-sm border border-gray-300 rounded px-0.5 py-0.5 bg-white disabled:opacity-50">
                <option value="voice" title="Voice">🎤</option>
                <option value="text" title="Text">⌨</option>
              </select>
              <select value={qaCam} onChange={e => pickQaCam(e.target.value as 'head' | 'arm')} disabled={qaActive}
                title="Camera the robot answers from: 📷 head (looks up / straight / down) or 🦾 arm (one photo, the head stays)"
                className="text-sm border border-gray-300 rounded px-0.5 py-0.5 bg-white disabled:opacity-50">
                <option value="head" title="Head camera">📷</option>
                <option value="arm" title="Arm camera">🦾</option>
              </select>
              <select value={qaOnce ? 'once' : 'chat'} onChange={e => pickQaOnce(e.target.value === 'once')} disabled={qaActive}
                title="🔁 Interactive: keep answering until a stop word or Stop · 1️⃣ Once: answer one question and end"
                className="text-sm border border-gray-300 rounded px-0.5 py-0.5 bg-white disabled:opacity-50">
                <option value="chat" title="Interactive">🔁</option>
                <option value="once" title="Once">1️⃣</option>
              </select>
              <button onClick={toggleQa} disabled={running && !qaActive}
                title={qaActive ? 'End the Q&A conversation' : 'Ask the robot about what it sees (browser mic + head camera)'}
                className={`px-2.5 py-1.5 text-xs rounded text-white whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${qaActive ? 'bg-emerald-600 hover:bg-emerald-500 animate-pulse' : 'bg-indigo-600 hover:bg-indigo-500'}`}>
                {qaActive ? '■ Q&A' : '💬 Q&A'}
              </button>
            </div>
            <div className="p-3 border-b border-gray-200 flex-shrink-0">
              {/* Button-panel shortcuts run silently — no voice announcements. */}
              <ButtonPanel
                onRun={plan => run(plan, true, 'en', 'grace', false, false, 'frontend', 1, false, true, false)}
                refreshKey={skillRefreshKey} />
            </div>
            <div className="p-4 flex-1 overflow-y-auto">
              <PlanPanel events={agentEvents} steps={agentSteps} planMethod={runMethod} />
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
            <AgentPanel running={running} lang={lang} onRun={run} onStop={stop} recordEnabled={recordEnabled} onToggleRecord={toggleRecord} manualRecording={manualRecording} onToggleManualRecord={toggleManualRecord} backendLogDir={backendLogDir} trial={trial} />
          </section>

          <section className="px-5 pt-1 pb-3">
            <div className="flex gap-1 mb-2 border-b border-gray-200">
              {(['cameras', 'map'] as const).map(t => (
                <button key={t} onClick={() => setMainTab(t)}
                        className={`px-3 py-1.5 text-sm -mb-px border-b-2 ${mainTab === t ? 'border-blue-600 text-blue-700 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
                  {t === 'cameras' ? 'Cameras' : 'Map'}
                </button>
              ))}
              {/* Always live, unlike the Agent panel's Stop: a skill run from the
                  CLI or another client can be moving the robot while this tab
                  shows nothing running. */}
              <button onClick={stop}
                title="Cancel every command in flight on the robot (arm, lift, head, base) and end the run"
                className={`ml-auto self-center px-3 py-1 bg-red-600 hover:bg-red-500 text-white text-xs rounded`}>
                Cancel
              </button>
            </div>
            {mainTab === 'cameras'
              ? <CameraFeed clients={clients} logImage={logImage} onClearLog={() => setLogImage(null)} />
              : <MapPanel clients={clients} running={running} />}
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
      {chatOpen && (qaActive || textListen || qaLog.length > 0) && (
        <QaChat
          log={qaLog}
          mode={textListen ? 'text' : qaInput}
          waiting={textWaiting}
          active={qaActive || textListen}
          onSend={text => { addQaLine('user', text); textAskRef.current?.(text) }}
          onClose={() => setChatOpen(false)}
          onEnd={qaSkill ? endQa : undefined}
        />
      )}
    </div>
  )
}
