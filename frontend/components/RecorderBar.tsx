'use client'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { clock, countsText, fieldLabel, lastText, recPhase, recordBlock, type RecorderStatus } from '../lib/recorder'

const KEY = 'robotapp_rec_fields'
const load = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} } }

// Record raw VLA episodes while teleoperating (robot_agent /recorder). The operator fills the prompt FIELDS (action, target object ...), a sentence is
// generated from the robot's templates (a new wording each time), then Record starts remote control and the recording together; Stop saves the episode
// as success / failure or throws it away. Nothing is drawn when the robot has no recorder.
export default function RecorderBar({ status, runInFlight, onChanged }: { status: RecorderStatus | null; runInFlight: boolean; onChanged: () => void }) {
  const [fields, setFields] = useState<Record<string, string>>({})
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { setFields(load()) }, [])
  if (!status) return null
  const phase = recPhase(status), st = status.state
  const setField = (k: string, v: string) => setFields(f => { const n = { ...f, [k]: v }; try { localStorage.setItem(KEY, JSON.stringify(n)) } catch { /* per-viewer convenience only */ } return n })
  const fail = (e: unknown) => setErr(e instanceof Error ? e.message : String(e))
  const generate = () => api.makeRecordPrompt(fields, prompt.trim()).then(p => { setPrompt(p); setErr(''); return p })       // another sentence than the one shown
  const block = recordBlock(status, runInFlight, !!(fields.action || '').trim(), !!prompt.trim())
  const record = async () => {
    setBusy(true)
    try {
      const p = prompt.trim() || await generate()
      await api.startRecording(p, { fields })
      setPrompt('')                                      // the next episode gets a new wording
      setErr('')
    } catch (e) { fail(e) } finally { setBusy(false); onChanged() }
  }
  const stop = (label: 'success' | 'failure' | 'discard') => { setBusy(true); api.stopRecording(label).then(() => setErr('')).catch(fail).finally(() => { setBusy(false); onChanged() }) }
  return (
    <div data-testid="recorder-bar" className="mb-2 flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5 text-xs border border-gray-200 rounded px-2 py-1 bg-white">
        <span title="Record raw episodes for VLA training: remote control and the recording start together">{phase === 'recording' ? '🔴' : '⏺'}</span>
        {phase === 'recording' || phase === 'saving' ? (
          <>
            <span data-testid="recorder-prompt" className="px-1.5 py-0.5 rounded bg-gray-50 border border-gray-200 text-gray-700 max-w-[28rem] truncate" title={st?.prompt}>{st?.prompt}</span>
            <span data-testid="recorder-clock" className="font-mono text-red-600">{phase === 'saving' ? 'saving…' : `● ${clock(st?.elapsed_s)}`}</span>
            <span className="text-gray-500" title="frames recorded so far">{countsText(st?.counts)}</span>
            {phase === 'recording' && (
              <span className="ml-auto flex items-center gap-1">
                <button data-testid="recorder-success" disabled={busy} onClick={() => stop('success')} className="px-2 py-0.5 rounded bg-green-600 hover:bg-green-500 text-white disabled:opacity-60" title="Stop and save as a success">✔ Success</button>
                <button data-testid="recorder-failure" disabled={busy} onClick={() => stop('failure')} className="px-2 py-0.5 rounded bg-amber-500 hover:bg-amber-400 text-white disabled:opacity-60" title="Stop and save as a failure (kept, labelled)">✘ Failure</button>
                <button data-testid="recorder-discard" disabled={busy} onClick={() => stop('discard')} className="px-2 py-0.5 rounded border border-gray-300 bg-white text-gray-600 hover:bg-gray-100 disabled:opacity-60" title="Stop and throw this episode away">🗑 Discard</button>
              </span>
            )}
          </>
        ) : (
          <>
            {status.fields.map(k => (
              <input key={k} data-testid={`recorder-field-${k}`} value={fields[k] ?? ''} onChange={e => setField(k, e.target.value)} placeholder={fieldLabel(k)} aria-label={fieldLabel(k)}
                className="w-[8.5rem] px-1.5 py-0.5 rounded border border-gray-300 bg-white text-gray-800 placeholder:text-gray-400" />
            ))}
            <button data-testid="recorder-generate" onClick={() => generate().catch(fail)} disabled={!(fields.action || '').trim()} aria-label="Generate a prompt" title="Generate a prompt from the fields (press again for another wording)"
              className="px-1.5 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-100 text-violet-600 disabled:opacity-40">
              <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M10 3l1.7 4.6L16.3 9.3l-4.6 1.7L10 15.6 8.3 11 3.7 9.3 8.3 7.6z" /><path d="M18 13l.9 2.4 2.4.9-2.4.9L18 19.6l-.9-2.4-2.4-.9 2.4-.9z" /></svg></button>
            <input data-testid="recorder-prompt-input" value={prompt} onChange={e => setPrompt(e.target.value)} placeholder="prompt (made from the fields when empty)" aria-label="prompt"
              className="min-w-[14rem] flex-1 px-1.5 py-0.5 rounded border border-gray-300 bg-white text-gray-800 placeholder:text-gray-400" />
            <button data-testid="recorder-record" disabled={busy || !!block} onClick={record} title={block || 'Start remote control and record an episode'}
              className="ml-auto px-2 py-0.5 rounded bg-red-600 hover:bg-red-500 text-white disabled:opacity-50">● Record</button>
          </>
        )}
      </div>
      {(err || st?.error) && <div data-testid="recorder-error" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{err || st?.error}</div>}
      {phase === 'idle' && lastText(status) && <div data-testid="recorder-last" className="text-xs text-gray-500 px-1">{lastText(status)}{status.state?.last?.dir ? ` → ${status.state.last.dir}` : ''}</div>}
    </div>
  )
}
