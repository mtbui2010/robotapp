'use client'
import { chips, nextPlan, planTitle, progressLabel, type SeqState } from '../lib/planSequence'

// The bar of a preset that is a sequence of plans (docs/features/plan-sequence.md): which plan runs, and, when one is over, the click that
// runs the next one (or Retry / Skip after a failure) or stops. Nothing moves by itself between two plans.
const BTN = 'px-2 py-0.5 text-xs rounded whitespace-nowrap'

export default function SequenceBar({ seq, onNext, onRetry, onSkip, onStop }: {
  seq: SeqState; onNext: () => void; onRetry: () => void; onSkip: () => void; onStop: () => void
}) {
  if (seq.kind === 'idle' || seq.plans.length < 2) return null
  const n = seq.plans.length
  const nxt = nextPlan(seq)
  const marks = chips(seq)
  const chipCls = (m: string) => m === '▶' ? 'bg-blue-600 text-white' : m === '✓' ? 'bg-green-100 text-green-700 border-green-300'
    : m === '✗' ? 'bg-red-100 text-red-700 border-red-300' : m === '⏭' ? 'bg-amber-100 text-amber-700 border-amber-300' : 'bg-gray-100 text-gray-500'
  return (
    <div data-testid="seq-bar" data-state={seq.kind}
      className="mb-2 rounded border border-indigo-200 bg-indigo-50 px-2 py-1.5 flex flex-wrap items-center gap-2 text-xs text-gray-800">
      <span className="font-medium text-indigo-800">{progressLabel(seq)}</span>
      <span className="flex gap-1">
        {marks.map((c, i) => (
          <span key={i} title={`Plan ${c.label}: ${planTitle(seq.plans[i])}`}
            className={`px-1.5 rounded border border-transparent leading-5 ${chipCls(c.mark)}`}>{c.label} {c.mark}</span>
        ))}
      </span>
      {seq.kind === 'running' && <span className="text-gray-600">running… (Cancel stops the sequence)</span>}
      {seq.kind === 'waiting' && (<>
        <span className="text-gray-700">
          {seq.marks[seq.index] === 'skipped' ? `Plan ${seq.index + 1} skipped.` : `Plan ${seq.index + 1} done.`} Next: <b>Plan {seq.index + 2}</b>{nxt ? ` — ${planTitle(nxt)}` : ''}
        </span>
        <button data-testid="seq-next" onClick={onNext} className={`${BTN} bg-green-600 hover:bg-green-500 text-white`}
          title="Run the next plan (the robot moves)">▶ Run plan {seq.index + 2}</button>
        <button data-testid="seq-stop" onClick={onStop} className={`${BTN} bg-red-600 hover:bg-red-500 text-white`}
          title="End the sequence; the robot stays where it is">■ Stop</button>
      </>)}
      {seq.kind === 'failed' && (<>
        <span className="text-red-700">Plan {seq.index + 1} failed: the robot stayed where it stopped.</span>
        <button data-testid="seq-retry" onClick={onRetry} className={`${BTN} bg-blue-600 hover:bg-blue-500 text-white`}
          title="Run this plan again from its first step">↻ Retry plan {seq.index + 1}</button>
        <button data-testid="seq-skip" onClick={onSkip} className={`${BTN} bg-amber-500 hover:bg-amber-400 text-white`}
          title={seq.index + 1 >= n ? 'Count this plan as over: the sequence ends' : 'Count this plan as over; the next plan still waits for your click'}>⏭ Skip</button>
        <button data-testid="seq-stop" onClick={onStop} className={`${BTN} bg-red-600 hover:bg-red-500 text-white`}>■ Stop</button>
      </>)}
      {seq.kind === 'done' && (<>
        <span className="text-green-700">Sequence done ({n} plans{seq.marks.includes('skipped') ? `, ${seq.marks.filter(m => m === 'skipped').length} skipped` : ''}).</span>
        <button data-testid="seq-stop" onClick={onStop} className={`${BTN} bg-gray-200 hover:bg-gray-300 text-gray-700`}>Close</button>
      </>)}
    </div>
  )
}
