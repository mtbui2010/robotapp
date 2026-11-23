#!/usr/bin/env node
// Unit tests of lib/robotSessions.ts (the per-robot session store: pure, made-up robots only). Run: make unit
import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FE = join(ROOT, 'frontend')
const { buildSync } = createRequire(join(FE, 'package.json'))('esbuild')
const out = mkdtempSync(join(tmpdir(), 'robotapp-sessions-'))
const outfile = join(out, 'robotSessions.mjs')
buildSync({ entryPoints: [join(FE, 'lib', 'robotSessions.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'error' })
const S = await import(pathToFileURL(outfile).href)

const A = 'http://robot-a.test:1', B = 'http://robot-b.test:2'
const ka = S.robotKey('alpha'), kb = S.robotKey('beta')
// two robots; alpha is shown
const two = () => S.select(S.select(S.EMPTY_STORE, kb, B), ka, A)

test('keys: robot / fleet keys round-trip', () => {
  assert.equal(ka, 'robot:alpha'); assert.equal(S.fleetKey('f1'), 'fleet:f1')
  assert.ok(S.isRobotKey(ka)); assert.ok(!S.isRobotKey(S.fleetKey('f1')))
  assert.equal(S.nameOfKey(ka), 'alpha'); assert.equal(S.nameOfKey('robot:a:b'), 'a:b')
})

test('select: creates a blank session, shows it, and starts no run', () => {
  const st = S.select(S.EMPTY_STORE, ka, A)
  assert.equal(st.shown, ka)
  const s = S.shownOf(st)
  assert.equal(s.url, A); assert.equal(s.running, false); assert.equal(s.run.phase, 'idle'); assert.deepEqual(s.events, [])
  assert.equal(S.shownOf(S.EMPTY_STORE).running, false, 'nothing shown: a blank session, never null')
})

test('select: picking another robot keeps the first one running and shows the second one idle', () => {
  let st = S.select(S.EMPTY_STORE, ka, A)
  st = S.beginRun(st, ka, A, 100); st = S.applyRun(st, ka, { t: 'start' })
  st = S.select(st, kb, B)
  assert.equal(S.shownOf(st).key, kb); assert.equal(S.statusOf(S.shownOf(st)), 'idle')
  assert.equal(S.statusOf(S.sessionOf(st, ka)), 'running', 'alpha keeps running in the background')
  assert.equal(S.startBlock(st, kb), null, 'beta takes a command while alpha runs')
  st = S.select(st, ka, A)
  assert.equal(S.shownOf(st).running, true, 'picking alpha again shows its live state')
})

test('select: a busy session keeps its frozen url, an idle one takes the new url', () => {
  let st = S.beginRun(two(), ka, A, 1); st = S.applyRun(st, ka, { t: 'start' })
  st = S.select(st, ka, 'http://moved.test:9')
  assert.equal(S.sessionOf(st, ka).url, A)
  st = S.select(S.select(S.EMPTY_STORE, kb, B), kb, 'http://moved.test:9')
  assert.equal(S.sessionOf(st, kb).url, 'http://moved.test:9')
})

test('update / patch / applyRun: an unknown key leaves the store unchanged', () => {
  const st = two()
  assert.equal(S.patch(st, 'robot:ghost', { trial: 3 }), st)
  assert.equal(S.update(st, 'robot:ghost', s => s), st)
  assert.equal(S.applyRun(st, 'robot:ghost', { t: 'start' }), st)
  assert.equal(S.patch(st, kb, { trial: 3 }).sessions[kb].trial, 3)
  assert.equal(S.patch(st, kb, { trial: 3 }).sessions[ka].trial, 0, 'only the named session changes')
})

test('beginRun: freezes the url, clears the last run, keeps the chat log', () => {
  let st = two()
  st = S.patch(st, ka, { qaLog: [{ who: 'user', text: 'hi' }], events: [{ event: 'x' }], logImage: 'img', trial: 4, verdict: 'failed' })
  st = S.beginRun(st, ka, 'http://other.test:5', 500)
  const s = S.sessionOf(st, ka)
  assert.equal(s.url, 'http://other.test:5'); assert.equal(s.running, true); assert.equal(s.startedAt, 500); assert.equal(s.endedAt, null)
  assert.deepEqual(s.events, []); assert.equal(s.logImage, null); assert.equal(s.trial, 0); assert.equal(s.verdict, null)
  assert.equal(s.qaLog.length, 1)
  assert.equal(S.sessionOf(st, kb).running, false)
})

test('endRun: stops the run, clears the asks, keeps the result and the chat', () => {
  let st = S.beginRun(two(), ka, A, 10)
  st = S.patch(st, ka, { listenId: 'q1', choice: { id: 'c', options: ['x'], prompt: 'p' }, qaSkill: true, qaLog: [{ who: 'robot', text: 'hello' }] })
  st = S.endRun(st, ka, 'success', 99)
  const s = S.sessionOf(st, ka)
  assert.equal(s.running, false); assert.equal(s.listenId, null); assert.equal(s.choice, null); assert.equal(s.qaSkill, false)
  assert.equal(s.verdict, 'success'); assert.equal(s.endedAt, 99); assert.equal(s.qaLog.length, 1)
})

test('statusOf: idle, running, waiting, stopping, lost, and running between two iterations of a repeat', () => {
  let st = S.beginRun(two(), ka, A, 1)
  const st_ = k => S.statusOf(S.sessionOf(st, k))
  assert.equal(st_(ka), 'running', 'a repeat between two runs: running flag, socket not yet open')
  st = S.applyRun(st, ka, { t: 'start' }); assert.equal(st_(ka), 'running')
  st = S.applyRun(st, ka, { t: 'listen' }); assert.equal(st_(ka), 'waiting')
  st = S.applyRun(st, ka, { t: 'answered' }); st = S.applyRun(st, ka, { t: 'stop' }); assert.equal(st_(ka), 'stopping')
  st = S.applyRun(st, ka, { t: 'done' }); st = S.endRun(st, ka, 'aborted', 2); assert.equal(st_(ka), 'idle')
  let lost = S.beginRun(two(), kb, B, 1); lost = S.applyRun(lost, kb, { t: 'start' }); lost = S.applyRun(lost, kb, { t: 'ws-close' })
  lost = S.endRun(lost, kb, 'error', 3)
  assert.equal(S.statusOf(S.sessionOf(lost, kb)), 'lost', 'socket gone while the backend run may live')
})

test('statusMap: only the non-idle robots, one entry per running robot', () => {
  let st = S.beginRun(two(), ka, A, 1); st = S.applyRun(st, ka, { t: 'start' })
  assert.deepEqual(S.statusMap(st), { [ka]: 'running' })
  assert.deepEqual(S.statusMap(S.EMPTY_STORE), {})
})

test('optionText: the mark goes first; idle keeps the caller text', () => {
  assert.equal(S.optionText('alpha', 'idle', '🤖 '), '🤖 alpha')
  assert.equal(S.optionText('alpha', 'idle'), 'alpha')
  assert.equal(S.optionText('alpha', 'running', '🤖 '), '● alpha · running')
  assert.equal(S.optionText('alpha', 'waiting'), '◆ alpha · asks you')
  assert.equal(S.optionText('alpha', 'stopping'), '○ alpha · stopping')
  assert.equal(S.optionText('alpha', 'lost'), '▲ alpha · lost')
})

test('startBlock (R4): a running robot refuses a second command and says why; idle / unknown / fleet are allowed', () => {
  let st = S.beginRun(two(), ka, A, 1); st = S.applyRun(st, ka, { t: 'start' })
  assert.match(S.startBlock(st, ka), /alpha.*running|two clients/i)
  assert.equal(S.startBlock(st, kb), null)
  assert.equal(S.startBlock(st, 'robot:ghost'), null)
  assert.equal(S.startBlock(st, S.fleetKey('f1')), null)
})

test('cancelTarget (R3): the displayed session and its frozen url, never the other robot', () => {
  let st = S.beginRun(two(), ka, A, 1); st = S.applyRun(st, ka, { t: 'start' })
  assert.deepEqual(S.cancelTarget(st), { key: ka, url: A })
  st = S.select(st, kb, B)
  assert.deepEqual(S.cancelTarget(st), { key: kb, url: B }, 'after the switch a Cancel names beta, the shown robot')
  assert.deepEqual(S.targetOf(st, ka), { key: ka, url: A }, 'an async continuation holding alpha key still reaches alpha')
  assert.equal(S.targetOf(st, 'robot:ghost'), null)
  st = S.select(st, ka, 'http://moved.test:9')
  assert.equal(S.cancelTarget(st).url, A, 'a url edit cannot move a live run')
})

test('cancelTarget: null when nothing is shown or a fleet is shown', () => {
  assert.equal(S.cancelTarget(S.EMPTY_STORE), null)
  assert.equal(S.cancelTarget(S.select(S.EMPTY_STORE, S.fleetKey('f1'), A)), null)
})

test('reconcile: sessions of robots that left the registry are dropped and named', () => {
  let st = S.beginRun(two(), kb, B, 1)
  const r = S.reconcile(st, [{ name: 'alpha' }])
  assert.deepEqual(r.dropped, [kb]); assert.equal(S.sessionOf(r.store, kb), undefined); assert.ok(S.sessionOf(r.store, ka))
  assert.equal(r.store.shown, ka, 'the shown robot stays')
  const r2 = S.reconcile(st, [{ name: 'beta' }])
  assert.deepEqual(r2.dropped, [ka]); assert.equal(r2.store.shown, null, 'the shown session was dropped')
  assert.equal(S.reconcile(st, [{ name: 'alpha' }, { name: 'beta' }]).store, st, 'nothing left: same store')
  assert.deepEqual(S.reconcile(S.select(st, S.fleetKey('f1'), A), []).dropped.filter(k => k.startsWith('fleet:')), [], 'fleet keys are not robots')
})

test('chat log: per-robot lines, identical consecutive robot lines once, user lines kept', () => {
  let a = S.appendLine([], 'robot', 'hello'); a = S.appendLine(a, 'robot', 'hello'); a = S.appendLine(a, 'user', 'hello'); a = S.appendLine(a, 'user', 'hello')
  assert.equal(a.length, 3)
  assert.deepEqual(S.appendLine([], 'robot', 'x', 'say'), [{ who: 'robot', text: 'x', kind: 'say' }])
  let st = S.patch(two(), ka, { qaLog: S.appendLine([], 'user', 'only alpha') })
  assert.equal(S.sessionOf(st, kb).qaLog.length, 0)
})

test('settleHeard: the pending line becomes the transcript, or goes away', () => {
  const log = [{ who: 'robot', text: 'q' }, { who: 'user', text: S.HEARD_PENDING }]
  assert.deepEqual(S.settleHeard(log, 'yes')[1], { who: 'user', text: 'yes' })
  assert.deepEqual(S.settleHeard(log, null), [log[0]])
  assert.equal(S.settleHeard([log[0]], 'yes').length, 1, 'no pending line: unchanged')
})

test('verdictOf / closeLine: the grey line closing a run', () => {
  assert.equal(S.verdictOf({ event: 'done', status: 'success' }), 'success')
  assert.equal(S.verdictOf({ event: 'done', status: 'planned' }), 'planned')
  assert.equal(S.verdictOf({ event: 'done', status: 'aborted' }), 'aborted')
  assert.equal(S.verdictOf({ event: 'done', status: 'failed' }), 'failed')
  assert.equal(S.verdictOf({ event: 'done', success: true }), 'success')
  assert.equal(S.verdictOf({ event: 'done' }), 'failed')
  assert.equal(S.verdictOf({ event: 'error', msg: 'x' }), 'error')
  assert.deepEqual(S.closeLine({ event: 'done', status: 'success' }), { who: 'system', text: '✓ done' })
  assert.match(S.closeLine({ event: 'done', status: 'planned', msg: 'm' }).text, /planned.*— m/)
  assert.equal(S.closeLine({ event: 'done', status: 'failed', msg: 'bad' }).text, '✗ failed — bad')
  assert.equal(S.closeLine({ event: 'error', msg: 'boom' }).text, '✗ error: boom')
})

test('newHandles: each call is a fresh object (no sharing between robots)', () => {
  const h1 = S.newHandles(), h2 = S.newHandles()
  assert.notEqual(h1, h2); assert.notEqual(h1.repeat, h2.repeat); assert.equal(h1.ws, null)
})

const busyAlpha = () => { let st = S.beginRun(two(), ka, A, 1); return S.applyRun(st, ka, { t: 'start' }) }

test('reconcile: a running robot renamed in place keeps its session under the new name (one client per robot still holds)', () => {
  const st = S.select(busyAlpha(), S.robotKey('alpha2'), A)   // the page already made a blank session for the new name
  const r = S.reconcile(st, [{ name: 'alpha2', url: A }, { name: 'beta', url: B }])
  assert.deepEqual(r.renamed, [[ka, S.robotKey('alpha2')]]); assert.deepEqual(r.dropped, [])
  assert.equal(S.statusOf(r.store.sessions[S.robotKey('alpha2')]), 'running')
  assert.ok(S.startBlock(r.store, S.robotKey('alpha2')), 'a second command on the renamed robot is refused')
  assert.equal(r.store.sessions[ka], undefined); assert.equal(r.store.shown, S.robotKey('alpha2'))
})

test('reconcile: a removed running robot is dropped so the caller cancels it', () => {
  const r = S.reconcile(busyAlpha(), [{ name: 'beta', url: B }])
  assert.deepEqual(r.dropped, [ka]); assert.deepEqual(r.renamed, [])
})

test('syncUrls: an idle session follows an edited url after its run ended; a busy one keeps the url of its run', () => {
  const U2 = 'http://robot-a.test:9'
  let st = busyAlpha()
  assert.equal(S.syncUrls(st, [{ name: 'alpha', url: U2 }]).sessions[ka].url, A, 'busy: frozen')
  st = S.endRun(S.applyRun(st, ka, { t: 'reset' }), ka, 'success', 5)
  st = S.syncUrls(st, [{ name: 'alpha', url: U2 }])
  assert.equal(S.cancelTarget(st).url, U2, 'after the run: the live url')
})
