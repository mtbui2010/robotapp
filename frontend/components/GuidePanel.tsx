'use client'
import { useState } from 'react'

type Step = {
  number: number
  title: string
  description: string
  detail: string
  example?: string
}

const STEPS: Step[] = [
  {
    number: 1,
    title: 'Start a robot agent',
    description: 'Run a robot package on the host so the dashboard has something to talk to.',
    detail: 'Option A — run an existing robot package:  cd kcare_robot && make install && make run.  Option B — generate a new robot from the cookiecutter template:  pip install cookiecutter, then cookiecutter https://github.com/mtbui2010/robot_template, answer the prompts, then cd <package_name> && make install && make run.  Either way the agent ends up listening on http://<host>:8001 — keep that URL for Step 2.',
    example: 'cookiecutter https://github.com/mtbui2010/robot_template',
  },
  {
    number: 2,
    title: 'Register the running robot',
    description: 'Point the dashboard at the agent URL from Step 1 so it can load skills.',
    detail: 'In the Robot Agent picker at the top of the left sidebar, click "+ Add", enter a name and the agent URL (http://localhost:8001 if it\'s on the same machine), then Save. Click "Connect" to load skills — a green "✓ N skills" badge confirms success.',
    example: 'http://localhost:8001',
  },
  {
    number: 3,
    title: 'Connect an LLM',
    description: 'The LLM turns natural-language commands into a task plan.',
    detail: 'In the Connections panel click "+ Add", choose type "LLM", pick a provider (Llama / ChatGPT / Gemini). For ChatGPT/Gemini enter the API key (saved server-side; leave blank later to keep). Then mark one LLM as active with the radio button next to it.',
    example: '{"name": "llama", "url": "http://localhost:11434", "model": "llama3"}',
  },
  {
    number: 4,
    title: 'Connect to ROS',
    description: 'Add the ROS services, topics, and actions your skills need.',
    detail: 'Click "Scan ROS" to discover ROS2 endpoints on the robot, then click "+ add" next to each one to quick-connect. Or add manually via "+ Add" → type ROS Service / ROS Topic / ROS Action. The form auto-suggests encode/decode templates from the data_interface.',
    example: '{"conn_name": "/skill_pick", "data_interface": "rosinterfaces/srv/SendStringData"}',
  },
  {
    number: 5,
    title: 'Add a camera (optional)',
    description: 'Show the robot\'s view in the Camera panel.',
    detail: 'Either add a WebRTC connection with is_camera: true, or mark an existing ROS image topic with is_camera: true. The feed appears in the Camera section of the main panel.',
    example: '{"host": "192.168.1.10", "port": 8443, "is_camera": true}',
  },
  {
    number: 6,
    title: 'Tune skills & globals (optional)',
    description: 'Edit per-skill configs, global ENV/HOME_LOC, or save shortcut buttons.',
    detail: 'The Skills panel lists skills loaded from the active robot — click a skill to view/edit its live config, "Reload" to re-import after code changes, or "+ add" for custom internal (Python module) or external (HTTP URL) skills. The Global Configs panel exposes shared values like ENV and HOME_LOC. In the second sidebar, save common plans as one-click shortcut buttons.',
    example: '',
  },
  {
    number: 7,
    title: 'Send a command',
    description: 'Two input modes — natural language or scripted skill calls.',
    detail: 'Pick a language (EN / KO / VI), then choose: Unstructured = type a natural-language command (LLM plans it); Structured = type one "skill::params" per line in any of the 4 cells (runs the active cell directly, no LLM). Press Run, or Ctrl+Enter on a Structured cell. Watch the Task Plan and Execution Timeline update live.',
    example: 'find::apple\nnavigate::kitchen\npick::cup',
  },
]

const EXAMPLES = [
  'give me the pringles',
  'move to the shelf and pick up the bottle',
  'find the cup and bring it to me',
  'go left and pick the cola, then return',
  'check if the light is on',
]

const CONNECTION_CONFIGS: { type: string; label: string; example: string }[] = [
  { type: 'ROS Service', label: 'ROS Service', example: '{"conn_name": "/skill_pick", "data_interface": "rosinterfaces/srv/SendStringData", "is_client": true}' },
  { type: 'ROS Topic',   label: 'ROS Topic (camera)', example: '{"conn_name": "/camera/rgb", "data_interface": "sensor_msgs/msg/Image", "is_camera": true, "is_client": true}' },
  { type: 'ROS Action',  label: 'ROS Action',  example: '{"conn_name": "/navigate", "data_interface": "nav2_msgs/action/NavigateToPose", "is_client": true}' },
  { type: 'WebRTC',      label: 'WebRTC Camera', example: '{"host": "192.168.1.10", "port": 8443, "is_camera": true}' },
  { type: 'TCP/IP',      label: 'TCP/IP (client)', example: '{"host": "localhost", "port": 8888, "is_client": true}' },
  { type: 'LLM-Llama',   label: 'LLM — Llama (local)', example: '{"name": "llama", "url": "http://localhost:11434", "model": "llama3"}' },
  { type: 'LLM-ChatGPT', label: 'LLM — ChatGPT', example: '{"name": "chatgpt", "model": "gpt-4o"}' },
  { type: 'LLM-Gemini',  label: 'LLM — Gemini',  example: '{"name": "gemini", "model": "gemini-2.0-flash"}' },
]

export default function GuidePanel() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'steps' | 'examples' | 'configs'>('steps')
  const [copied, setCopied] = useState<string | null>(null)

  const copy = (text: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text)
    } else {
      const el = document.createElement('textarea')
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopied(text)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 text-xs bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 rounded-md flex items-center gap-1.5"
      >
        <span className="text-base leading-none">?</span>
        Guide
      </button>

      {/* Modal overlay */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20"
          onClick={e => { if (e.target === e.currentTarget) setOpen(false) }}
        >
          <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-[560px] max-h-[80vh] flex flex-col">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div>
                <h2 className="font-semibold text-gray-900">Getting Started</h2>
                <p className="text-xs text-gray-400 mt-0.5">Follow these steps to control the robot</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >×</button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-100 px-5">
              {([
                { key: 'steps',    label: 'Workflow' },
                { key: 'examples', label: 'Command Examples' },
                { key: 'configs',  label: 'Config Reference' },
              ] as const).map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-4 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors ${
                    tab === t.key
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="overflow-y-auto flex-1 px-5 py-4">

              {/* Workflow steps */}
              {tab === 'steps' && (
                <div className="flex flex-col gap-4">
                  {STEPS.map(step => (
                    <div key={step.number} className="flex gap-3">
                      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
                        {step.number}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-800 text-sm">{step.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{step.description}</p>
                        <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">{step.detail}</p>
                        {step.example && (
                          <button
                            onClick={() => copy(step.example!)}
                            className="mt-2 w-full text-left font-mono text-[11px] bg-gray-50 border border-gray-200 rounded px-2.5 py-1.5 text-gray-600 hover:bg-gray-100 flex items-center justify-between group"
                          >
                            <span className="truncate">{step.example}</span>
                            <span className="ml-2 text-gray-400 group-hover:text-blue-500 flex-shrink-0 text-[10px]">
                              {copied === step.example ? '✓ copied' : 'copy'}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Flow diagram */}
                  <div className="mt-2 bg-gray-50 border border-gray-200 rounded-lg p-4">
                    <p className="text-[11px] text-gray-400 uppercase font-medium mb-3">Execution Flow</p>
                    <div className="flex flex-col items-center gap-1 text-xs text-gray-600">
                      {[
                        { label: 'Your command', color: 'bg-blue-100 text-blue-700 border-blue-200' },
                        null,
                        { label: 'LLM plans tasks', color: 'bg-purple-100 text-purple-700 border-purple-200' },
                        null,
                        { label: 'Tasks execute (parallel where safe)', color: 'bg-amber-100 text-amber-700 border-amber-200' },
                        null,
                        { label: 'Robot performs actions via ROS2', color: 'bg-green-100 text-green-700 border-green-200' },
                      ].map((item, i) =>
                        item === null ? (
                          <span key={i} className="text-gray-300 text-base leading-none">↓</span>
                        ) : (
                          <span key={i} className={`px-3 py-1.5 rounded-md border text-xs font-medium ${item.color}`}>
                            {item.label}
                          </span>
                        )
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Command examples */}
              {tab === 'examples' && (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-gray-500 mb-1">
                    These are example natural-language commands. The LLM will break them into robot skills automatically.
                  </p>
                  {EXAMPLES.map(ex => (
                    <button
                      key={ex}
                      onClick={() => copy(ex)}
                      className="w-full text-left px-3 py-2.5 bg-gray-50 hover:bg-blue-50 border border-gray-200 hover:border-blue-200 rounded-lg text-sm text-gray-700 flex items-center justify-between group transition-colors"
                    >
                      <span>"{ex}"</span>
                      <span className="text-xs text-gray-400 group-hover:text-blue-500 ml-3 flex-shrink-0">
                        {copied === ex ? '✓ copied' : 'copy'}
                      </span>
                    </button>
                  ))}
                  <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
                    <p className="font-medium mb-1">Tips</p>
                    <ul className="space-y-1 list-disc list-inside text-amber-600">
                      <li>Name objects clearly: "the red cup", "pringles can"</li>
                      <li>Describe destination: "to me", "on the table", "to the shelf"</li>
                      <li>You can chain actions: "go to shelf, pick the bottle, return"</li>
                      <li>Use KO/VI mode for Korean or Vietnamese input</li>
                      <li>Switch to Structured mode to bypass the LLM and call skills directly (one <span className="font-mono">skill::params</span> per line)</li>
                    </ul>
                  </div>
                </div>
              )}

              {/* Config reference */}
              {tab === 'configs' && (
                <div className="flex flex-col gap-3">
                  <p className="text-xs text-gray-500 mb-1">
                    Reference configs for the "+ Add" form. The form has dedicated fields for these values — the JSON shown is what gets sent. ChatGPT / Gemini API keys are entered in a separate password field and stored server-side, not in the config.
                  </p>
                  {CONNECTION_CONFIGS.map(cfg => (
                    <div key={cfg.type} className="border border-gray-200 rounded-lg overflow-hidden">
                      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
                        <span className="text-xs font-medium text-gray-700">{cfg.label}</span>
                        <button
                          onClick={() => copy(cfg.example)}
                          className="text-[10px] text-gray-400 hover:text-blue-500"
                        >
                          {copied === cfg.example ? '✓ copied' : 'copy'}
                        </button>
                      </div>
                      <pre
                        className="px-3 py-2.5 text-[11px] font-mono text-gray-600 cursor-pointer hover:bg-gray-50"
                        onClick={() => copy(cfg.example)}
                      >
                        {cfg.example}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
