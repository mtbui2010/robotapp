import type { ForeignRun } from '../lib/useForeignRun'

// The plan below belongs to a run this tab did not start. Cancel (the red button) still stops it.
export default function ForeignRunBadge({ run }: { run: ForeignRun | null }) {
  if (!run) return null
  return (
    <div data-testid="foreign-run-badge" title="This run was not started from this tab. Cancel stops it as usual."
      className="mb-2 px-2 py-1 text-[11px] rounded border bg-sky-50 border-sky-300 text-sky-800 break-words">
      Run started by the fleet / another client · <span className="font-mono">{run.runId}</span> · {run.ended ? 'ended' : 'running'}
    </div>
  )
}
