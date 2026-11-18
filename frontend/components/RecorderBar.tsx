'use client'
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { PoseList } from '../lib/poses'
import { clock, countsText, fieldLabel, lastText, parseRecRows, recPhase, recordBlock, savingText, type RecorderStatus, type RecRows } from '../lib/recorder'

const KEY = 'robotapp_rec_rows', OLD_KEY = 'robotapp_rec_fields'
const saved = (): RecRows => { try { return parseRecRows(localStorage.getItem(KEY), localStorage.getItem(OLD_KEY)) } catch { return parseRecRows(null, null) } }

// Record raw VLA episodes while teleoperating (robot_agent /recorder). The operator fills the prompt FIELDS (action, target object ...), a sentence is
// generated from the robot's templates (a new wording each time), then Record starts remote control and the recording together; Stop saves the episode
// as success / failure or throws it away. Nothing is drawn when the robot has no recorder.
export default function RecorderBar({ status, runInFlight, onChanged, poses }: { status: RecorderStatus | null; runInFlight: boolean; onChanged: () => void; poses?: PoseList | null }) {
  // Two rows of fields (e.g. open drawer / close drawer): the checked one is what Record uses; the ✨ of a row shows a sample sentence under it.
  const [{ rows, inits, before, active }, setRows] = useState<RecRows>(() => parseRecRows(null, null))
  const [going, setGoing] = useState('')                                 // the name of the pose the arm is going to before the recording starts
  const [demo, setDemo] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  useEffect(() => { setRows(saved()) }, [])
  if (!status) return null
  const phase = recPhase(status), st = status.state
  const keep = (n: RecRows) => { try { localStorage.setItem(KEY, JSON.stringify(n)) } catch { /* per-viewer convenience only */ } return n }
  const setField = (i: number, k: string, v: string) => setRows(r => keep({ ...r, rows: r.rows.map((f, j) => (j === i ? { ...f, [k]: v } : f)) }))
  const setInit = (i: number, id: string) => setRows(r => keep({ ...r, inits: r.inits.map((x, j) => (j === i ? id : x)) }))
  const setBefore = (i: number, on: boolean) => setRows(r => keep({ ...r, before: r.before.map((x, j) => (j === i ? on : x)) }))
  const setActive = (i: number) => setRows(r => keep({ ...r, active: i }))
  const fail = (e: unknown) => setErr(e instanceof Error ? e.message : String(e))
  const generate = (i: number) => api.makeRecordPrompt(rows[i], demo[i] || undefined).then(p => { setDemo(d => { const n = [...d]; n[i] = p; return n }); setErr('') }).catch(fail)   // another sentence than the one shown
  const fields = rows[active] ?? {}
  const block = recordBlock(status, runInFlight, !!(fields.action || '').trim(), false)
  const initPose = poses?.poses.find(p => p.id === inits[active])         // the checked row's "Go to" pose (gone from the list = none)
  const record = async () => {
    setBusy(true)
    try {
      const prompt = await api.makeRecordPrompt(fields)                    // first: a wording problem must not cost a move
      if (initPose && !before[active]) {                                   // default: the arm goes to the start pose; only then do the recording and remote control begin
        setGoing(initPose.label)
        const r = await api.runPose(initPose.id)
        if (!r.isdone) throw new Error(`could not go to "${initPose.label}": ${r.msg || 'the move failed'} (nothing is recorded)`)
      }
      await api.startRecording(prompt, { fields })                         // a new wording for every episode
      setDemo([]); setErr('')
      if (initPose && before[active]) {                                    // recording first: the move is part of the episode (the backend marks it as the init part)
        setGoing(initPose.label)
        try {
          const r = await api.runPose(initPose.id)
          if (!r.isdone) throw new Error(r.msg || 'the move failed')
          if (status.teleop) await api.enableTeleop(status.teleop, true, true)   // arrived: remote control starts again, as after a Go to
        } catch (e) { fail(new Error(`could not go to "${initPose.label}": ${e instanceof Error ? e.message : String(e)}. The recording is running and remote control is off: stop it (✘ Failure) or discard it.`)) }
      }
    } catch (e) { fail(e) } finally { setGoing(''); setBusy(false); onChanged() }
  }
  const stop = (label: 'success' | 'failure' | 'discard') => { setBusy(true); api.stopRecording(label).then(() => setErr('')).catch(fail).finally(() => { setBusy(false); onChanged() }) }
  return (
    <div data-testid="recorder-bar" className="mb-2 flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5 text-xs border border-gray-200 rounded px-2 py-1 bg-white">
        <span title="Record raw episodes for VLA training: remote control and the recording start together">{phase === 'recording' ? <span className="text-blue-600 animate-pulse">⏺</span> : '⏺'}</span>
        {phase === 'recording' || phase === 'saving' ? (
          <>
            <span data-testid="recorder-prompt" className="px-1.5 py-0.5 rounded bg-gray-50 border border-gray-200 text-gray-700 max-w-[28rem] truncate" title={st?.prompt}>{st?.prompt}</span>
            <span data-testid="recorder-clock" className="font-mono text-blue-600">{phase === 'saving' ? 'saving…' : `● ${clock(st?.elapsed_s)}`}</span>
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
            <div className="flex flex-1 min-w-0 flex-col gap-1">
              {rows.map((f, i) => (
                <div key={i} className="flex flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <input type="checkbox" data-testid={`recorder-use-${i}`} checked={active === i} onChange={() => setActive(i)} aria-label={`record with row ${i + 1}`}
                      title="Record uses this row (one row is always checked)" className="accent-blue-600" />
                    {poses && (
                      <select data-testid={`recorder-init-${i}`} value={poses.poses.some(p => p.id === inits[i]) ? inits[i] : ''} onChange={e => setInit(i, e.target.value)} disabled={busy} aria-label={`Go to a pose before recording (row ${i + 1})`}
                        title="Go to…: the pose (of the saved Go to poses) the arm goes to when you press Record with this row. By default it goes first and the recording starts after it arrived (the move is not in the episode); tick “rec first” to record the move too. Empty: record from where the arm is."
                        className={`w-[90px] px-1 py-0.5 rounded border bg-white ${inits[i] && poses.poses.some(p => p.id === inits[i]) ? 'border-blue-300 text-blue-700' : 'border-gray-300 text-gray-700'}`}>
                        <option value="">Go to…</option>
                        {poses.poses.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                      </select>)}
                    {poses?.poses.some(p => p.id === inits[i]) && (
                      <label className="flex items-center gap-0.5 text-[11px] text-gray-500" title="Start recording BEFORE the move to the Go to pose, so the move is in the episode (as its init part). Off (default): the arm goes there first and the recording starts after it arrived.">
                        <input type="checkbox" data-testid={`recorder-before-${i}`} checked={before[i]} onChange={e => setBefore(i, e.target.checked)} disabled={busy} className="accent-blue-600" />rec first</label>)}

                    {status.fields.map(k => (
                      <input key={k} data-testid={`recorder-field-${i}-${k}`} value={f[k] ?? ''} onChange={e => setField(i, k, e.target.value)} placeholder={fieldLabel(k)} aria-label={`${fieldLabel(k)} (row ${i + 1})`}
                        className={`w-[8.5rem] px-1.5 py-0.5 rounded border bg-white text-gray-800 placeholder:text-gray-400 ${active === i ? 'border-blue-300' : 'border-gray-300'}`} />
                    ))}
                    <button data-testid={`recorder-generate-${i}`} onClick={() => void generate(i)} disabled={!(f.action || '').trim()} aria-label={`Generate a sample prompt (row ${i + 1})`}
                      title="Show a sample sentence made from these fields (press again for another wording). Record makes its own."
                      className="px-1.5 py-0.5 rounded border border-gray-300 bg-white hover:bg-gray-100 text-violet-600 disabled:opacity-40">
                      <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M10 3l1.7 4.6L16.3 9.3l-4.6 1.7L10 15.6 8.3 11 3.7 9.3 8.3 7.6z" /><path d="M18 13l.9 2.4 2.4.9-2.4.9L18 19.6l-.9-2.4-2.4-.9 2.4-.9z" /></svg></button>
                  </div>
                  {demo[i] && <div data-testid={`recorder-demo-${i}`} className="pl-6 text-[11px] text-gray-500">→ {demo[i]}</div>}
                </div>))}
            </div>
            {/* one Record for both rows: it uses the checked one */}
            <button data-testid="recorder-record" disabled={busy || !!block} onClick={record} title={block || `${initPose ? `Go to "${initPose.label}", then start` : 'Start'} remote control and record an episode with row ${active + 1}`}
              className="self-center px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 whitespace-nowrap">{going ? `going to ${going}…` : '● Record'}</button>
          </>
        )}
      </div>
      {(err || st?.error) && <div data-testid="recorder-error" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">{err || st?.error}</div>}
      {savingText(status) && <div data-testid="recorder-saving" className="text-xs text-gray-500 px-1" title="The last episode is being copied to the shared folder in the background: you can record the next one now">⏳ {savingText(status)} <span className="text-gray-400">(in the background: you can record again)</span></div>}
      {phase === 'idle' && lastText(status) && <div data-testid="recorder-last" className="text-xs text-gray-500 px-1">{lastText(status)}{status.state?.last?.dir ? ` → ${status.state.last.dir}` : ''}</div>}
    </div>
  )
}
