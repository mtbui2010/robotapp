'use client'
import { useState, useEffect } from 'react'

const LS_CELLS  = 'robotapp_cells'
const LS_PROMPT = 'robotapp_prompt'

function loadCells(): string[] {
  try { return JSON.parse(localStorage.getItem(LS_CELLS) || '["","","",""]') }
  catch { return ['', '', '', ''] }
}

interface Props {
  running: boolean
  onRun: (plan: string, direct: boolean) => void
  onStop: () => void
}

export default function AgentPanel({ running, onRun, onStop }: Props) {
  const [mode,       setMode]       = useState<'structured' | 'unstructured'>('structured')
  const [cells,      setCells]      = useState<string[]>(['', '', '', ''])
  const [activeCell, setActiveCell] = useState(0)
  const [prompt,     setPrompt]     = useState('')
  const [lang,       setLang]       = useState('en')

  useEffect(() => {
    setCells(loadCells())
    setPrompt(localStorage.getItem(LS_PROMPT) || '')
  }, [])

  const updateCell = (i: number, val: string) => {
    setCells(prev => {
      const next = [...prev]
      next[i] = val
      localStorage.setItem(LS_CELLS, JSON.stringify(next))
      return next
    })
  }

  const updatePrompt = (val: string) => {
    setPrompt(val)
    localStorage.setItem(LS_PROMPT, val)
  }

  const run = () => {
    if (mode === 'structured') onRun(cells[activeCell], true)
    else onRun(prompt, false)
  }

  const cellClass = (i: number) =>
    `w-full h-full min-h-0 block bg-white text-gray-800 text-sm font-mono px-3 py-1 placeholder-gray-300 focus:outline-none resize-none border rounded ${
      activeCell === i ? 'border-blue-500' : 'border-gray-300'
    }`

  return (
    <div className="flex flex-col gap-1">

      {/* Mode + lang + run row */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3 text-sm text-gray-700">
          {(['structured', 'unstructured'] as const).map(m => (
            <label key={m} className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="radio"
                name="inputMode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
                className="accent-blue-600"
              />
              {m === 'structured' ? 'Structured' : 'Unstructured'}
            </label>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <select value={lang} onChange={e => setLang(e.target.value)}
            className="bg-white border border-gray-300 text-gray-800 text-sm rounded px-2 py-1">
            <option value="en">EN</option>
            <option value="ko">KO</option>
            <option value="vi">VI</option>
          </select>
          {running
            ? <button onClick={onStop}
                className="px-4 py-1 bg-red-600 hover:bg-red-500 text-white text-sm rounded">Stop</button>
            : <button onClick={run}
                className="px-4 py-1 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded">Run</button>
          }
        </div>
      </div>

      {/* Input area */}
      {mode === 'structured' ? (
        <div className="flex flex-col gap-1">
          <div className="grid grid-cols-[2fr_1fr] grid-rows-1 gap-2" style={{ height: '90px' }}>
            <textarea
              rows={1}
              value={cells[0]}
              onChange={e => updateCell(0, e.target.value)}
              onFocus={() => setActiveCell(0)}
              onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); run() } }}
              placeholder={'find::apple\nnavigate::kitchen\npick::cup'}
              className={cellClass(0)}
            />
            <div className="flex flex-col gap-1 h-full min-h-0">
              {[1, 2, 3].map(i => (
                <textarea
                  key={i}
                  rows={1}
                  value={cells[i]}
                  onChange={e => updateCell(i, e.target.value)}
                  onFocus={() => setActiveCell(i)}
                  onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); run() } }}
                  placeholder="skill::params"
                  className={`${cellClass(i)} flex-1 min-h-0`}
                />
              ))}
            </div>
          </div>
          <p className="text-[11px] text-gray-400">Click cell to select · Ctrl+Enter = run active</p>
        </div>
      ) : (
        <input
          value={prompt}
          onChange={e => updatePrompt(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && run()}
          placeholder='Command, e.g. "give me the cup"'
          className="w-full bg-white border border-gray-300 text-gray-800 text-sm rounded px-3 py-2 placeholder-gray-400 focus:outline-none focus:border-blue-500"
        />
      )}

    </div>
  )
}
