#!/usr/bin/env node
// Unit tests of the pure frontend modules, no dependencies beyond what `make install` gives (esbuild comes with
// next): lib/planView.ts replayed against recorded event files (scripts/fixtures/events, recorded by
// homeloop_live) and lib/chatMic.ts (mic owner state machine, echo guard).  Run: make unit
import { createRequire } from 'node:module'
import { readFileSync, readdirSync, mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FE = join(ROOT, 'frontend')
const { buildSync } = createRequire(join(FE, 'package.json'))('esbuild')
const out = mkdtempSync(join(tmpdir(), 'robotapp-unit-'))
const load = async name => {
  const outfile = join(out, name + '.mjs')
  buildSync({ entryPoints: [join(FE, 'lib', name + '.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'error' })
  return import(pathToFileURL(outfile).href)
}
const PV = await load('planView')
const CM = await load('chatMic')
const CR = await load('chatRun')

const FIX = join(ROOT, 'scripts/fixtures/events')
const fixtures = Object.fromEntries(readdirSync(FIX).filter(f => f.endsWith('.json'))
  .map(f => [f.replace('.json', ''), JSON.parse(readFileSync(join(FIX, f), 'utf8'))]))
const steps = v => v.rows.filter(r => r.kind === 'step')
const notes = v => v.rows.filter(r => r.kind === 'note')
// success as the planView reads it: SAGE events carry `status`, Structured (legacy) ones `success` / `result.isdone`
const okOf = e => (e.status != null ? (e.status === 'success' || e.status === 'planned') : e.success === true || e.result?.isdone === true)
const count = (ev, name) => ev.filter(e => e.event === name).length

// ── planView: invariants over every recorded run, at every prefix ──────────────────────────────
for (const [name, ev] of Object.entries(fixtures)) {
  test(`planView ${name}: invariants at every prefix and at the end`, () => {
    let v = PV.emptyPlanView()
    ev.forEach((e, i) => {
      v = PV.reducePlan(v, e)
      const s = v.rows
      // settled rows (done / failed / running / notes) come before every pending row
      const firstPending = s.findIndex(r => r.kind === 'step' && r.status === 'pending')
      if (firstPending >= 0) assert.ok(s.slice(firstPending).every(r => r.kind === 'step' && r.status === 'pending'), `order broken after event ${i} (${e.event})`)
      assert.ok(steps(v).filter(r => r.status === 'running').length <= 1, `two running rows after event ${i}`)
      assert.equal(new Set(s.map(r => r.id)).size, s.length, 'row ids are unique')
    })
    const st = steps(v)
    assert.equal(st.filter(r => r.status === 'pending' || r.status === 'running').length, 0, 'nothing left pending / running after done')
    // every started step is a row; every step_done decided one
    assert.equal(st.filter(r => r.status === 'done' || r.status === 'failed').length, count(ev, 'step_start'))
    assert.equal(st.filter(r => r.status === 'failed').length, ev.filter(e => e.event === 'step_done' && !okOf(e)).length)
    // notes: one per replan / recover / clarify
    assert.equal(notes(v).length, count(ev, 'replan') + count(ev, 'recover') + count(ev, 'clarify'))
    const done = ev.find(e => e.event === 'done')
    assert.equal(v.final.ok, okOf(done))
    assert.equal(v.final.msg, done.msg ?? '')
  })
}

test('planView apple_en (replan + search legs, ends failed): done steps kept above the new plan', () => {
  const ev = fixtures.apple_en_replan_fail
  const at = ev.findIndex(e => e.event === 'replan')
  let v = PV.buildPlanView(ev.slice(0, at))
  assert.deepEqual(steps(v).map(r => [r.label, r.status]), [
    ['MoveTo counter@kitchen', 'done'], ['Find apple', 'failed'], ['Pick apple', 'pending'], ['Place counter@kitchen', 'pending']])
  v = PV.buildPlanView(ev.slice(0, at + 1))                         // right after the replan event
  const rp = ev[at]
  assert.deepEqual(steps(v).slice(0, 2).map(r => [r.label, r.status]), [['MoveTo counter@kitchen', 'done'], ['Find apple', 'failed']])
  const note = notes(v).find(n => n.note === 'replan')
  assert.equal(note.detail, rp.reason)
  assert.deepEqual(steps(v).filter(r => r.status === 'pending').map(r => r.label), rp.plan)
  // the note sits between the history and the new plan
  const ni = v.rows.indexOf(note)
  assert.ok(v.rows.slice(0, ni).every(r => r.kind === 'note' || r.status !== 'pending'))
  assert.ok(v.rows.slice(ni + 1).every(r => r.kind === 'step' && r.status === 'pending'))
  // search legs and second looks are spliced rows with a recovery note, the planned rest is untouched
  const end = PV.buildPlanView(ev)
  assert.equal(notes(end).filter(n => n.note === 'recover').length, 6)
  assert.ok(steps(end).filter(r => r.spliced).length >= 6)
  assert.equal(steps(end).filter(r => r.retry).length, 6, 'each failed Find is retried after its leg')
  assert.equal(end.final.ok, false)
  assert.match(end.final.msg, /could not find the apple/)
  assert.deepEqual(end.goals, [{ type: 'on', object: 'apple', from: '', to: 'counter@kitchen' }])
})

test('planView apple_ko (replan + legs, ends success): the plan tail runs after the splice', () => {
  const v = PV.buildPlanView(fixtures.apple_ko_replan_success)
  assert.equal(v.final.ok, true)
  const labels = steps(v).filter(r => r.status === 'done').map(r => r.label)
  assert.deepEqual(labels.slice(-3), ['Pick apple', 'MoveTo counter@kitchen', 'Place counter@kitchen'])
  assert.ok(steps(v).some(r => r.label === 'Open fridge@kitchen' && r.spliced))
  assert.equal(v.goalChecks.length, 1)
})

test('planView mug_s2 (retry / relook / asked, ends failed): the failed Pick is kept and retried', () => {
  const v = PV.buildPlanView(fixtures.mug_s2_retry_relook_fail)
  const picks = steps(v).filter(r => r.label === 'Pick red mug')
  assert.ok(picks.length >= 4 && picks.every(r => r.status === 'failed'))
  assert.ok(picks.some(r => r.retry))
  assert.equal(v.final.ok, false)
  assert.ok(notes(v).some(n => n.note === 'ask'), 'the clarification question is a row')
  assert.ok(steps(v).filter(r => r.status === 'failed').every(r => r.reason))
})

test('planView simple success: ticks in order, no notes except the question', () => {
  const v = PV.buildPlanView(fixtures.mug_en_simple_success)
  assert.deepEqual(steps(v).map(r => r.status), ['done', 'done', 'done', 'done', 'done'])
  assert.ok(notes(v).every(n => n.note === 'ask'))
  assert.equal(v.final.ok, true)
})

test('planView phone_s1 (early failure): untouched steps are skipped, run failed', () => {
  const v = PV.buildPlanView(fixtures.phone_s1_early_fail)
  assert.equal(v.final.ok, false)
  assert.ok(steps(v).some(r => r.status === 'failed'))
  assert.ok(steps(v).some(r => r.status === 'skipped'))
})

test('planView: mid-run the current step is marked and a new run resets the view', () => {
  const ev = fixtures.mug_en_simple_success
  const i = ev.findIndex(e => e.event === 'step_start' && e.index === 2)
  const v = PV.buildPlanView(ev.slice(0, i + 1))
  assert.deepEqual(steps(v).map(r => r.status), ['done', 'done', 'running', 'pending', 'pending'])
  assert.equal(PV.reducePlan(v, { event: 'start' }).rows.length, 0)
})

test('planView: stopped (client side) closes a run that has no done', () => {
  const ev = fixtures.mug_en_simple_success
  const i = ev.findIndex(e => e.event === 'step_start' && e.index === 2)
  const v = PV.buildPlanView([...ev.slice(0, i + 1), { event: 'stopped' }])
  assert.deepEqual(steps(v).map(r => r.status), ['done', 'done', 'failed', 'skipped', 'skipped'])
  assert.equal(v.final.status, 'stopped'); assert.equal(v.final.ok, false)
})

test('planView: legacy / direct events (plan text, task strings, no action field)', () => {
  const evs = [
    { event: 'plan', plan_text: 'find::apple\nnavigate::kitchen' },
    { event: 'step_start', step: 0, total: 2, task: 'find::apple' },
    { event: 'step_done', step: 0, result: { isdone: true } },
    { event: 'step_start', step: 1, total: 2, task: 'navigate::kitchen' },
    { event: 'step_done', step: 1, result: { isdone: false, msg: 'blocked' } },
    { event: 'done', success: false },
  ]
  const v = PV.buildPlanView(evs)
  assert.deepEqual(steps(v).map(r => [r.label, r.status]), [['find::apple', 'done'], ['navigate::kitchen', 'failed']])
  assert.equal(steps(v)[1].reason, 'blocked')
  assert.equal(v.final.ok, false)
})

// ── chatMic ─────────────────────────────────────────────────────────────────────────────────────
const snap = (o = {}) => ({ handsFree: true, running: false, waiting: false, speaking: false, lastSpeechAt: 0, ...o })

test('chatMic: listens only when hands-free, idle, robot silent', () => {
  assert.deepEqual(CM.micVerdict(snap(), 5000), { listen: true })
  assert.equal(CM.micVerdict(snap({ handsFree: false }), 5000).reason, 'off')
  assert.equal(CM.micVerdict(snap({ running: true }), 5000).reason, 'running')
  assert.equal(CM.micVerdict(snap({ running: true, waiting: true }), 5000).reason, 'waiting')   // the answer capture owns the mic
  assert.equal(CM.micVerdict(snap({ speaking: true }), 5000).reason, 'speaking')
})

test('chatMic: guard time after the robot stops speaking', () => {
  const last = 10_000
  const v = CM.micVerdict(snap({ lastSpeechAt: last }), last + 400)
  assert.equal(v.listen, false); assert.equal(v.reason, 'guard'); assert.equal(v.retryMs, CM.GUARD_MS - 400)
  assert.equal(CM.micVerdict(snap({ lastSpeechAt: last }), last + CM.GUARD_MS).listen, true)
  assert.equal(CM.trackSpeech(last, true, 12_000), 12_000)
  assert.equal(CM.trackSpeech(last, false, 12_000), last)
})

test('chatMic: chat state', () => {
  assert.equal(CM.chatState(false, false), 'idle')
  assert.equal(CM.chatState(true, false), 'running')
  assert.equal(CM.chatState(true, true), 'waiting')
})

test('chatMic: echo guard drops what the robot just said, keeps new commands', () => {
  const g = CM.createEchoGuard()
  g.note('Where is the apple?', 1000)
  assert.equal(g.isEcho('where is the apple', 3000), true)           // same words
  assert.equal(g.isEcho('Where is the app', 3000), true)             // truncated
  assert.equal(g.isEcho('the apple', 3000), true)                    // a piece of the line
  assert.equal(g.isEcho('Please put the red mug on the dining table', 3000), false)
  assert.equal(g.isEcho('where is the apple', 1000 + CM.ECHO_WINDOW_MS + 1), false, 'older than the window')
  g.note('식탁 위에 컵을 놓겠습니다', 20_000)
  assert.equal(g.isEcho('식탁 위에 컵을 놓겠습니다', 22_000), true)  // Korean: no word spaces needed
  assert.equal(g.isEcho('', 22_000), false)
  assert.ok(CM.similarity('abc def', 'abc def') === 1 && CM.similarity('apple', 'zzzzz') === 0)
})

test('chatMic: a transcript is dropped when the state changed while recognising', () => {
  const g = CM.createEchoGuard()
  assert.deepEqual(CM.acceptTranscript(snap(), 'put the cup on the table', g, 5000), { accept: true })
  assert.equal(CM.acceptTranscript(snap({ running: true }), 'put the cup on the table', g, 5000).reason, 'busy')
  assert.equal(CM.acceptTranscript(snap({ speaking: true }), 'put the cup on the table', g, 5000).reason, 'busy')
  assert.equal(CM.acceptTranscript(snap({ lastSpeechAt: 4800 }), 'put the cup on the table', g, 5000).reason, 'busy')
  assert.equal(CM.acceptTranscript(snap(), '  ', g, 5000).reason, 'empty')
  g.note('I will move to kitchen counter', 4000)
  assert.equal(CM.acceptTranscript(snap(), 'i will move to kitchen counter', g, 6000).reason, 'echo')
})

test('planView structured run (legacy events: plan as text lines, step_start with a Python list): 4 steps, 4 done, none left over', () => {
  const ev = fixtures.structured_say_wait
  const v = PV.buildPlanView(ev)
  const s = steps(v)
  assert.equal(s.length, 4, 'one row per plan line, not one more per started step')
  assert.ok(s.every(r => r.status === 'done'), JSON.stringify(s.map(r => r.status)))
  assert.deepEqual(s.map(r => r.label), ["say::inputs='hello', lang='en'", 'wait::1', "say::inputs='bye', lang='en'", 'wait::1'])
  assert.equal(v.final?.ok, true)
  // the same at every prefix: never more rows than plan lines
  let w = PV.emptyPlanView()
  for (const e of ev) { w = PV.reducePlan(w, e); assert.ok(steps(w).length <= 4) }
})

// ── durations and Log matching (planView: `_rx`, `seq`) ───────────────────────────────────────────
const stamp = (ev, t0 = 1_000_000, dt = 500) => ev.map((e, i) => ({ ...e, _rx: t0 + i * dt }))

test('planView: rows get startedAt / endedAt from _rx and seq = start order (matches the Log steps)', () => {
  const ev = stamp(fixtures.apple_en_replan_fail)
  const v = PV.buildPlanView(ev)
  const started = steps(v).filter(r => r.status !== 'skipped' && r.status !== 'pending')
  assert.equal(started.length, count(ev, 'step_start'))
  // the Log (page.tsx) appends one step per step_start: row.seq is that position, whatever the row order
  assert.deepEqual(started.map(r => r.seq).sort((a, b) => a - b), started.map((_, i) => i))
  const startEv = ev.filter(e => e.event === 'step_start')
  for (const r of started) {
    assert.equal(r.startedAt, startEv[r.seq]._rx, 'startedAt is the receive time of the seq-th step_start')
    assert.ok(r.endedAt >= r.startedAt, 'ended after it started')
  }
  assert.ok(steps(v).filter(r => r.status === 'skipped' || r.status === 'pending').every(r => r.seq == null && r.startedAt == null))
})

test('planView: without _rx (recorded files) no duration is known; Stop closes the running row with its time', () => {
  const v = PV.buildPlanView(fixtures.mug_en_simple_success)
  assert.ok(steps(v).every(r => r.startedAt == null && r.endedAt == null))
  const ev = stamp(fixtures.mug_en_simple_success)
  const i = ev.findIndex(e => e.event === 'step_start')
  const w = PV.buildPlanView([...ev.slice(0, i + 1), { event: 'stopped', _rx: 2_000_000 }])
  const run = steps(w).find(r => r.seq === 0)
  assert.equal(run.status, 'failed'); assert.equal(run.endedAt, 2_000_000)
})

test('chatMic answerBy: chat run with the mic off is typed whatever the backend mode; mic on / Structured keep the mode', () => {
  const a = (runFromChat, micOn, listenMode) => CM.answerBy({ runFromChat, micOn, listenMode })
  for (const m of ['voice', 'whisper', 'text', undefined]) assert.equal(a(true, false, m), 'typing')
  assert.equal(a(true, true, 'voice'), 'voice')
  assert.equal(a(true, true, undefined), 'voice')
  assert.equal(a(true, true, 'text'), 'typing')
  assert.equal(a(false, false, 'voice'), 'voice')   // Structured run: backend decides
  assert.equal(a(false, false, 'text'), 'typing')
})

// ── chatRun: Stop / Reset life cycle ─────────────────────────────────────────────────────────────────────────────────
const play = (...evs) => evs.reduce((s, t) => CR.runReduce(s, { t }), CR.INITIAL_RUN)
test('chatRun: a normal run, asked and answered, ends idle with nothing alive', () => {
  const s = play('start', 'listen', 'answered', 'done')
  assert.deepEqual(s, { phase: 'idle', alive: false, ws: true, stuck: false })
  assert.equal(CR.canStop(s), false)
  assert.equal(CR.canType(play('start')), false)
  assert.equal(CR.canType(play('start', 'listen')), true)
})
test('chatRun: Stop goes to stopping and ends with done, or with the socket closing', () => {
  for (const evs of [['start', 'stop', 'done'], ['start', 'listen', 'stop', 'ws-close']]) {
    const mid = play(...evs.slice(0, -1))
    assert.equal(mid.phase, 'stopping')
    assert.equal(CR.canType(mid), false)
    const end = play(...evs)
    assert.equal(end.phase, 'idle'); assert.equal(end.alive, false)
  }
})
test('chatRun: Stop twice quickly stays stopping; a late listen / answer does not leave stopping', () => {
  const s = play('start', 'stop', 'stop', 'listen', 'answered', 'cancel-ack')
  assert.equal(s.phase, 'stopping')       // the socket is open: only done / ws-close end it
  assert.equal(s.stuck, false)
})
test('chatRun: no confirmation for STOP_TIMEOUT_MS -> stuck -> Force reset is offered, reset always works', () => {
  assert.equal(CR.STOP_TIMEOUT_MS, 5000)
  const s = play('start', 'stop', 'timeout')
  assert.equal(CR.needsForce(s), true)
  assert.equal(CR.needsForce(play('start', 'timeout')), false)     // timeout only means something while stopping
  assert.deepEqual(CR.runReduce(s, { t: 'reset' }), CR.INITIAL_RUN)
  for (const st of ['start', 'listen'].map((_, i) => play(...['start', 'listen'].slice(0, i + 1)))) {
    assert.deepEqual(CR.runReduce(st, { t: 'reset' }), CR.INITIAL_RUN)
  }
})
test('chatRun: a socket that drops mid-run leaves a run that may be alive: Stop stays available', () => {
  const lost = play('start', 'ws-close')
  assert.equal(lost.phase, 'idle'); assert.equal(lost.alive, true)
  assert.equal(CR.isLost(lost), true); assert.equal(CR.canStop(lost), true); assert.equal(CR.canType(lost), true)
  const stopping = CR.runReduce(lost, { t: 'stop' })
  assert.equal(stopping.phase, 'stopping')
  // no socket, so no `done`: the acknowledged cancel is the end
  assert.equal(CR.runReduce(stopping, { t: 'cancel-ack' }).alive, false)
  assert.equal(CR.runReduce(stopping, { t: 'cancel-ack' }).phase, 'idle')
  // a stop with nothing alive and the socket closed after its done is a no-op
  assert.equal(CR.runReduce(play('start', 'done', 'ws-close'), { t: 'stop' }).phase, 'idle')
})
test('chatRun: cancel-ack with an open socket waits for done; start is ignored unless idle', () => {
  assert.equal(play('start', 'stop', 'cancel-ack').phase, 'stopping')
  assert.equal(play('start', 'stop', 'start').phase, 'stopping')
  assert.equal(play('start', 'listen', 'start').phase, 'waiting')
})


test('chatRun: every stop button asks stopAction: stop first, force reset once stuck', () => {
  const play = (...ev) => ev.reduce((s, t) => CR.runReduce(s, { t }), CR.INITIAL_RUN)
  assert.equal(CR.stopAction(CR.INITIAL_RUN), 'stop')           // the tab-row Cancel is always live
  assert.equal(CR.stopAction(play('start')), 'stop')
  assert.equal(CR.stopAction(play('start', 'stop')), 'stop')
  assert.equal(CR.stopAction(play('start', 'stop', 'timeout')), 'force-reset')
})

test('chatRun: stop button label is the same everywhere (Stopping..., Force reset)', () => {
  const play = (...ev) => ev.reduce((s, t) => CR.runReduce(s, { t }), CR.INITIAL_RUN)
  assert.equal(CR.stopLabel(play('start'), 'Cancel'), 'Cancel')
  assert.equal(CR.stopLabel(play('start', 'stop')), 'Stopping…')
  assert.equal(CR.stopLabel(play('start', 'stop', 'timeout'), 'Cancel'), 'Force reset')
})

test('chatRun: stop button label and action pair up in every state (the same flow for every base label)', () => {
  const play = (...ev) => ev.reduce((s, t) => CR.runReduce(s, { t }), CR.INITIAL_RUN)
  for (const st of [CR.INITIAL_RUN, play('start'), play('start', 'stop'), play('start', 'stop', 'timeout')])
    for (const base of ['Stop', 'Cancel', 'Run/Stop'])
      assert.equal(CR.stopAction(st) === 'force-reset', CR.stopLabel(st, base) === 'Force reset')
})

test('chatRun: a 404 on the audio answer (listen timed out) has a chat note', () => {
  assert.match(CR.LISTEN_GONE_NOTE, /timed out/)
  assert.match(CR.noteForListenReply({ gone: true }), /timed out/)
  assert.equal(CR.noteForListenReply({ gone: false }), null)
})


// ── mapObjects: the Map tab's objects layer (declared by MAP.objects) ──────────────────────────────────────────────
const MO = await load('mapObjects')
const OBJ_CFG = { agent: 'a', read: { method: 'get' }, path: 'objects', poll_s: 0.1,
                  fields: { x: 'x', y: 'y', label: 'name', kind: 'cls' },
                  actions: { move: { skill: 'mv', params: { id: '{id}', x: '{x}', y: '{y}', where: 'at {place}' } } } }
test('mapObjects parse: a dict under path, entries without x / y dropped, held ones follow the robot', () => {
  const reply = { objects: { o1: { x: 1, y: 2, name: 'cup', cls: 'mug', at: 'table' }, o2: { name: 'nowhere' }, o3: { x: 0, y: 0, name: 'ball', held: true } } }
  const objs = MO.parseObjects(reply, OBJ_CFG)
  assert.deepEqual(objs.map(o => o.id), ['o1', 'o3'])
  assert.equal(objs[0].label, 'cup'); assert.equal(objs[0].place, 'table')
  assert.deepEqual(MO.drawnAt(objs[0], null), [1, 2])
  assert.deepEqual(MO.drawnAt(objs[1], { x: 5, y: 6 }), [5, 6]); assert.equal(MO.drawnAt(objs[1], null), null)
  assert.deepEqual(MO.parseObjects({ objects: [{ id: 'k', x: 1, y: 1, name: 'n' }] }, OBJ_CFG).map(o => o.id), ['k'])   // a list works too
  assert.deepEqual(MO.parseObjects({}, OBJ_CFG), []); assert.deepEqual(MO.parseObjects(null, OBJ_CFG), [])
})
test('mapObjects actions: Move / Remove / Add exist only when the backend declares them; templates keep types', () => {
  assert.equal(MO.hasAction(OBJ_CFG, 'move'), true)
  assert.equal(MO.hasAction(OBJ_CFG, 'remove'), false)
  assert.equal(MO.hasAction(OBJ_CFG, 'spawn'), false)
  assert.equal(MO.hasAction(undefined, 'move'), false)
  assert.deepEqual(MO.fillCall(OBJ_CFG.actions.move, { id: 'o1', x: 1.23456, y: 2, place: 'desk' }),
                   { id: 'o1', x: 1.235, y: 2, where: 'at desk' })
  assert.deepEqual(MO.fillCall({ skill: 's', params: { p: '{place}', q: 'k' } }, {}), { q: 'k' })     // not given: left out, never the literal
})

test('mapObjects actions: a device-agent command template ({agent, send}) counts as declared and is filled like a skill call', () => {
  const cfg = { agent: 'a', actions: { move: { agent: 'sim', send: { cmd: 'move_object', body: '{id}', x: '{x}' } }, spawn: { agent: '', send: {} } } }
  assert.equal(MO.hasAction(cfg, 'move'), true)
  assert.equal(MO.hasAction(cfg, 'spawn'), false)                      // no agent: not usable
  assert.deepEqual(MO.fillCall(cfg.actions.move, { id: 'cup', x: 0.5 }), { cmd: 'move_object', body: 'cup', x: 0.5 })
})
test('mapObjects move templates: click-move and place-pick send only what is filled (HL-like and sim-like templates)', () => {
  const hl = { skill: 'move_object', params: { id: '{id}', x: '{x}', y: '{y}', place: '{place}' } }
  assert.deepEqual(MO.fillCall(hl, { id: 'o1', x: 1, y: 2, cls: 'mug' }), { id: 'o1', x: 1, y: 2 })
  assert.deepEqual(MO.fillCall(hl, { id: 'o1', place: 'desk' }), { id: 'o1', place: 'desk' })
  const ks = { agent: 'sim', send: { cmd: 'move_object', body: '{id}', x: '{x}', y: '{y}' } }
  assert.deepEqual(MO.fillCall(ks, { id: 'cup', x: 0.5, y: 1 }), { cmd: 'move_object', body: 'cup', x: 0.5, y: 1 })
  assert.equal(MO.callUses(ks, 'place'), false); assert.equal(MO.callUses(hl, 'place'), true)   // the place select shows only for hl
})
test('mapObjects read / poll / colour / pick: send body, minimum period, same kind same colour, nearest marker', () => {
  assert.deepEqual(MO.readRequest(OBJ_CFG), { agent: 'a', send: null })
  assert.deepEqual(MO.readRequest({ agent: 's', read: { method: 'send', body: { cmd: 'state' } } }), { agent: 's', send: { cmd: 'state' } })
  assert.equal(MO.pollMs({ agent: 'a' }), 1000); assert.equal(MO.pollMs({ agent: 'a', poll_s: 0.01 }), 200)
  assert.equal(MO.kindColor('mug'), MO.kindColor('mug')); assert.notEqual(MO.kindColor('mug'), MO.kindColor('apple'))
  const objs = [{ id: 'a', x: 0, y: 0, label: 'a', kind: '', place: '', held: false }, { id: 'b', x: 0.1, y: 0, label: 'b', kind: '', place: '', held: false }]
  assert.equal(MO.nearestObject(objs, 0.09, 0).id, 'b'); assert.equal(MO.nearestObject(objs, 5, 5), null)
})

// api.answerListenAudio reports failures instead of swallowing them
test('api.answerListenAudio: a 500 / unreachable server is an error, 404 is "gone", 200 is the text', async () => {
  const outfile = join(out, 'api.mjs')
  buildSync({ entryPoints: [join(FE, 'lib', 'api.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'error',
              define: { 'process.env.NEXT_PUBLIC_AGENT_URL': '"http://x"' } })
  globalThis.window = { location: { origin: 'http://x', protocol: 'http:', hostname: 'x' } }
  globalThis.localStorage = { getItem: () => null, setItem() {} }
  const { api } = await import(pathToFileURL(outfile).href)
  const orig = globalThis.fetch
  const reply = (status, body) => async () => new Response(JSON.stringify(body), { status })
  try {
    globalThis.fetch = reply(500, { detail: 'CUDA out of memory' })
    const e = await api.answerListenAudio('a', new Blob(['x']), 'audio/webm')
    assert.equal(e.text, ''); assert.match(e.error, /HTTP 500: CUDA out of memory/)
    globalThis.fetch = async () => { throw new Error('connection refused') }
    assert.match((await api.answerListenAudio('a', null, '')).error, /cannot reach the robot/)
    globalThis.fetch = reply(404, { detail: 'no pending' })
    assert.equal((await api.answerListenAudio('a', null, '')).gone, true)
    globalThis.fetch = reply(200, { ok: true, text: 'hello' })
    assert.deepEqual(await api.answerListenAudio('a', null, ''), { text: 'hello' })
  } finally { globalThis.fetch = orig }
})

// ── tabPref: the language belongs to one tab (sessionStorage), localStorage only seeds a new tab ──
const TP = await load('tabPref')
const mkStore = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) } }
test('tabPref: a tab keeps its own language when another tab picks another one', () => {
  const local = mkStore()                                      // shared by the two tabs
  globalThis.localStorage = local
  globalThis.sessionStorage = mkStore()                        // tab A
  TP.writeTabPref('robotapp_lang', 'ko')
  const tabA = globalThis.sessionStorage
  globalThis.sessionStorage = mkStore()                        // tab B opens: no choice of its own yet -> the last one (ko)
  assert.equal(TP.readTabPref('robotapp_lang'), 'ko')
  TP.writeTabPref('robotapp_lang', 'en')                       // the operator picks EN in tab B
  assert.equal(TP.readTabPref('robotapp_lang'), 'en')
  globalThis.sessionStorage = tabA                             // tab A reloads / hot-reloads: still Korean
  assert.equal(TP.readTabPref('robotapp_lang'), 'ko')
  globalThis.sessionStorage = mkStore()                        // a third new tab starts from the last choice
  assert.equal(TP.readTabPref('robotapp_lang'), 'en')
})
test('tabPref: no storage at all does not throw, legacy key is a last resort', () => {
  globalThis.localStorage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
  globalThis.sessionStorage = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
  assert.equal(TP.readTabPref('robotapp_lang'), null)
  assert.doesNotThrow(() => TP.writeTabPref('robotapp_lang', 'ko'))
  const ls = mkStore(); ls.setItem('robotapp_qa_lang', 'ko')
  globalThis.localStorage = ls; globalThis.sessionStorage = mkStore()
  assert.equal(TP.readTabPref('robotapp_lang', 'robotapp_qa_lang'), 'ko')
})

test('tabPref: a tab that never chose keeps what it started with (pin) even when another tab changes the default', () => {
  const local = mkStore()
  globalThis.localStorage = local
  globalThis.sessionStorage = mkStore()                        // tab A starts: nothing stored anywhere -> its effective value is pinned
  TP.pinTabPref('robotapp_plan_only', '1')
  const tabA = globalThis.sessionStorage
  globalThis.sessionStorage = mkStore()                        // tab B opens and un-checks "plan only"
  TP.pinTabPref('robotapp_plan_only', '1')
  TP.writeTabPref('robotapp_plan_only', '0')
  globalThis.sessionStorage = tabA                             // tab A reloads: still plan only, not the other tab's choice
  assert.equal(TP.readTabPref('robotapp_plan_only'), '1')
  TP.pinTabPref('robotapp_plan_only', '0')                     // a pin never overrides a value the tab already has
  assert.equal(TP.readTabPref('robotapp_plan_only'), '1')
})
