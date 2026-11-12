// Life cycle of the chat's run as seen from the browser (no React; tested in scripts/test_lib.mjs).
//
//   idle      no run is known to be going
//   running   executing, nothing asked
//   waiting   the robot asked: a `listen` is pending
//   stopping  Stop was pressed: cancel sent, waiting for the backend's `done` (or the socket to close)
//
// `alive` = "a run may still be going on the backend": set when a run starts, cleared only by its `done` / `error`
// event, a confirmed stop or a reset. A socket that drops mid-run leaves phase idle but alive true ("lost"), so Stop
// and Reset stay offered. `stuck` = stopping for longer than STOP_TIMEOUT_MS: the card offers "Force reset".
// reset() always works, whatever the backend does.

export const STOP_TIMEOUT_MS = 5000

export type RunPhase = 'idle' | 'running' | 'waiting' | 'stopping'
export interface RunState { phase: RunPhase; alive: boolean; ws: boolean; stuck: boolean }
export type RunEvent =
  | { t: 'start' }        // a run's socket was opened
  | { t: 'listen' }       // the robot asked
  | { t: 'answered' }     // the question is answered / dropped
  | { t: 'stop' }         // Stop pressed (cancel is being sent)
  | { t: 'cancel-ack' }   // POST /agent/cancel answered
  | { t: 'done' }         // backend `done` / `error` event
  | { t: 'ws-close' }     // the run's socket closed or failed
  | { t: 'timeout' }      // STOP_TIMEOUT_MS passed while stopping
  | { t: 'reset' }        // hard reset

export const INITIAL_RUN: RunState = { phase: 'idle', alive: false, ws: false, stuck: false }

export function runReduce(s: RunState, e: RunEvent): RunState {
  switch (e.t) {
    case 'start':
      return s.phase === 'idle' ? { phase: 'running', alive: true, ws: true, stuck: false } : s
    case 'listen':
      return s.phase === 'running' ? { ...s, phase: 'waiting' } : s
    case 'answered':
      return s.phase === 'waiting' ? { ...s, phase: 'running' } : s
    case 'stop':
      if (s.phase === 'stopping') return s
      return s.phase === 'idle' && !s.alive ? s : { ...s, phase: 'stopping', stuck: false }
    case 'cancel-ack':
      // without a socket no `done` can arrive: the acknowledged cancel is the end
      return s.phase === 'stopping' && !s.ws ? { ...s, phase: 'idle', alive: false, stuck: false } : s
    case 'done':
      return { ...s, phase: 'idle', alive: false, stuck: false }
    case 'ws-close':
      if (s.phase === 'idle') return { ...s, ws: false }
      // a closed socket cancels the run on the backend; during a stop that is the answer, otherwise the run is "lost"
      return { phase: 'idle', alive: s.phase !== 'stopping', ws: false, stuck: false }
    case 'timeout':
      return s.phase === 'stopping' ? { ...s, stuck: true } : s
    case 'reset':
      return INITIAL_RUN
  }
}

export const canStop = (s: RunState): boolean => s.phase !== 'idle' || s.alive
export const canType = (s: RunState): boolean => s.phase === 'idle' || s.phase === 'waiting'
export const isLost = (s: RunState): boolean => s.phase === 'idle' && s.alive
export const needsForce = (s: RunState): boolean => s.phase === 'stopping' && s.stuck
