'use client'
import { decodeRawDepth, encode16BitGrayPng } from './depthPng'
import type { AgentEvent } from './types'

// Client-side vision logging for the "frontend" log target: the backend streams
// each detection's rgb / depth / detection-overlay / results over the agent
// WebSocket (AgentEvent.dataset) and we write them into a per-run folder named
// `<datetime>_<first task>` under the browser's download folder. Chrome honours
// a relative path in the download attribute, so a run lands together instead of
// as one flat dump.
//
// Every filename carries the verdict of the step it came from — `_succeed` or
// `_failed` — and the run summary carries the run's, so a captured set can be
// split by outcome without opening anything. A run that succeeded overall can
// still contain a failed step, which is why the two levels are separate.

type Dataset = NonNullable<AgentEvent['dataset']>

// Folder for one run: 20260805-143022_find_apple
export function runFolder(startedAt: Date, firstTask: string): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp = `${startedAt.getFullYear()}${p(startedAt.getMonth() + 1)}${p(startedAt.getDate())}`
    + `-${p(startedAt.getHours())}${p(startedAt.getMinutes())}${p(startedAt.getSeconds())}`
  const task = (firstTask || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
  return task ? `${stamp}_${task}` : stamp
}

function saveBlob(blob: Blob, path: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = path
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke late — Chrome needs the URL alive until the download starts.
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const b64ToBlob = (b64: string, type: string): Blob => {
  const bin = atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return new Blob([buf], { type })
}

// Whether the step (or run) a capture belongs to ended up working. Written
// into every filename so a folder can be sorted or globbed without opening
// anything — `*_failed_rgb.png` is the whole failed set.
export type Outcome = 'succeed' | 'failed'

// One saved capture: rgb.png, detect.png (rgb + boxes/masks), depth.png
// (16-bit), results.json.
//
// `outcome` is the verdict of the step this capture came from. It is only known
// once that step reports back, which is why the caller buffers captures rather
// than writing them the moment they arrive.
export async function saveDataset(ds: Dataset, runDir: string, seq: number,
                                  outcome?: Outcome): Promise<void> {
  const n = String(seq).padStart(3, '0')
  const tag = (ds.tag || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const base = `${runDir}/${n}${tag ? `_${tag}` : ''}${outcome ? `_${outcome}` : ''}`
  try {
    if (ds.rgb) saveBlob(b64ToBlob(ds.rgb, 'image/png'), `${base}_rgb.png`)
    if (ds.annotated) saveBlob(b64ToBlob(ds.annotated, 'image/png'), `${base}_detect.png`)
    if (ds.depth && ds.depth_w && ds.depth_h) {
      const u16 = await decodeRawDepth(ds.depth)
      const png = await encode16BitGrayPng(u16, ds.depth_w, ds.depth_h)
      saveBlob(png, `${base}_depth.png`)
    }
    if (ds.results !== undefined) {
      saveBlob(new Blob([JSON.stringify(ds.results, null, 2)], { type: 'application/json' }),
               `${base}_results.json`)
    }
  } catch (err) {
    console.error('[datasetLog] save failed:', err)
  }
}

// Run-level summary written once per run: task, outcome, and — for failed cases
// — the error/violation events that explain what went wrong. The run verdict
// goes in the filename too, so `run_failed.json` stands out in a directory
// listing of many runs.
export function saveRunSummary(runDir: string, summary: unknown, outcome?: Outcome): void {
  saveBlob(new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' }),
           `${runDir}/run${outcome ? `_${outcome}` : ''}.json`)
}
