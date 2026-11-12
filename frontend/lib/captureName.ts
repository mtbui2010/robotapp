// One naming rule for every file saved from a camera view (Capture, save_raw, Save both):
//   <camera>_<stamp>_<kind>.<ext>   head_20261104-101530_rgb.jpg
//                                   head_20261104-101530_depth.jpg
//                                   head_20261104-101530_depth_raw.png
// <camera> is the connection name without an _rgb / _depth / _color tail, so head_rgb and head_depth
// (and arm_rgb / arm_depth …) save under the same base and sort next to each other.
export type CaptureKind = 'rgb' | 'depth' | 'depth_raw'

export function cameraBase(name: string): string {
  const safe = (name || 'camera').replace(/[^\w.-]+/g, '_')
  return safe.replace(/[_-](rgb|depth|color|colour|image)$/i, '') || safe
}

// Local time, to the second. Pass the same stamp to several saves to get a matching set.
export function captureStamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

export function captureName(cam: string, kind: CaptureKind, ext: string, stamp: string = captureStamp()): string {
  return `${cameraBase(cam)}_${stamp}_${kind}.${ext}`
}

// Save both across cells: every mounted camera cell registers a saver under its base name, so "Save both" in
// head_rgb's cell also saves head_depth's cell (two connections, one stamp). Each saver writes what its own
// stream carries (rgb frame, and the raw depth when the stream has depth).
const savers = new Map<string, { base: string; save: (stamp: string) => void }>()
export function registerSaver(id: string, cam: string, save: (stamp: string) => void): () => void {
  savers.set(id, { base: cameraBase(cam), save })
  return () => { savers.delete(id) }
}
export function saveGroup(cam: string, stamp: string = captureStamp()): number {
  const base = cameraBase(cam)
  let n = 0
  savers.forEach(s => { if (s.base === base) { s.save(stamp); n++ } })
  return n
}
