'use client'
import { useState, useRef, useCallback } from 'react'
import DevicePanel  from '../components/DevicePanel'
import AgentPanel   from '../components/AgentPanel'
import CameraFeed   from '../components/CameraFeed'
import SkillPanel   from '../components/SkillPanel'
import EnvPanel     from '../components/EnvPanel'
import GuidePanel   from '../components/GuidePanel'
import PlanPanel    from '../components/PlanPanel'
import ButtonPanel  from '../components/ButtonPanel'
import { api }      from '../lib/api'
import type { ClientEntry, AgentEvent } from '../lib/types'
import type { Step } from '../components/PlanPanel'

export default function Home() {
  const [clients, setClients]         = useState<ClientEntry[]>([])
  const [skillRefreshKey, setSkillRefreshKey] = useState(0)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [planOpen, setPlanOpen]       = useState(true)
  const [running, setRunning]         = useState(false)
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([])
  const [agentSteps, setAgentSteps]   = useState<Step[]>([])
  const [logImage, setLogImage]       = useState<string | null>(null)
  const wsRef     = useRef<WebSocket | null>(null)
  const eventsRef = useRef<AgentEvent[]>([])
  const stepsRef  = useRef<Step[]>([])

  const emit = useCallback((events: AgentEvent[], steps: Step[]) => {
    eventsRef.current = events
    stepsRef.current  = steps
    setAgentEvents(events)
    setAgentSteps(steps)
  }, [])

  const run = useCallback((finalPrompt: string, direct: boolean, lang = 'en') => {
    if (!finalPrompt.trim() || running) return
    wsRef.current?.close()
    emit([], [])
    setRunning(true)

    const ws = api.agentWs()
    wsRef.current = ws

    ws.onopen = () => ws.send(JSON.stringify({ prompt: finalPrompt, lang, direct }))

    ws.onmessage = e => {
      const ev: AgentEvent = JSON.parse(e.data)
      const newEvents = [...eventsRef.current, ev]
      let newSteps = stepsRef.current

      if (ev.event === 'step_start') {
        newSteps = [...newSteps, {
          index: ev.step!,
          total: ev.total!,
          task: ev.task!,
          status: 'running' as const,
        }]
      } else if (ev.event === 'step_done') {
        newSteps = newSteps.map(s =>
          s.index === ev.step
            ? { ...s, status: (ev.result?.isdone ? 'done' : 'failed') as Step['status'], result: ev.result }
            : s
        )
      } else if (ev.event === 'step_log') {
        const entry = { data: ev.data ?? {}, image: ev.log_image ?? undefined, ts: ev.ts ?? Date.now() / 1000 }
        newSteps = newSteps.map(s =>
          s.index === ev.step ? { ...s, logs: [...(s.logs ?? []), entry] } : s
        )
        if (ev.log_image) setLogImage(ev.log_image)
      } else if (ev.event === 'done' || ev.event === 'error') {
        setRunning(false)
      }

      emit(newEvents, newSteps)
    }

    ws.onclose = () => setRunning(false)
    ws.onerror = () => setRunning(false)
  }, [running, emit])

  const stop = useCallback(() => {
    wsRef.current?.close()
    setRunning(false)
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 flex flex-col">

      {/* Top bar */}
      <header className="border-b border-gray-200 px-5 py-3 flex items-center gap-3 bg-white shadow-sm">
        <span className="font-bold text-lg tracking-tight">RobotApp</span>
        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">v2</span>
        <span className="text-xs text-gray-400 ml-1">powered by pyconnect</span>
        <div className="ml-auto">
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
              <EnvPanel />
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
        <aside className={`relative flex-shrink-0 border-r border-gray-200 flex flex-col bg-white transition-all duration-200 ${planOpen ? 'w-72' : 'w-0'}`}>
          <div className={`flex flex-col h-full overflow-hidden ${planOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'} transition-opacity duration-150`}>
            <div className="p-3 border-b border-gray-200 flex-shrink-0">
              <ButtonPanel onRun={plan => run(plan, true)} refreshKey={skillRefreshKey} />
            </div>
            <div className="p-4 flex-1 overflow-y-auto">
              <PlanPanel events={agentEvents} steps={agentSteps} />
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

          <section className="p-5 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">
              Unified Agent
            </h2>
            <AgentPanel running={running} onRun={run} onStop={stop} />
          </section>

          <section className="p-5">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Camera
            </h2>
            <CameraFeed clients={clients} logImage={logImage} />
          </section>

        </main>
      </div>
    </div>
  )
}
