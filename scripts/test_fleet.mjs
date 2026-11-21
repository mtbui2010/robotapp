#!/usr/bin/env node
// Unit tests of the Fleet tab's pure modules (lib/fleetView.ts) and of the fleet manager client (lib/fleet.ts, with a
// fake fetch / WebSocket / storage). Made-up robots, places and goals only.  Run: make unit
import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const FE = join(dirname(fileURLToPath(import.meta.url)), '..', 'frontend')
const { buildSync } = createRequire(join(FE, 'package.json'))('esbuild')
const out = mkdtempSync(join(tmpdir(), 'robotapp-fleet-'))
const load = async name => {
  const outfile = join(out, name + '.mjs')
  buildSync({ entryPoints: [join(FE, 'lib', name + '.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'error' })
  return import(pathToFileURL(outfile).href)
}
const mkStore = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) } }
globalThis.window = { location: { origin: 'http://x', protocol: 'http:', hostname: 'x' }, dispatchEvent: () => true }
globalThis.localStorage = mkStore()
globalThis.sessionStorage = mkStore()
const FV = await load('fleetView')
const FE_ = await load('fleetEdit')
const FR = await load('fleetRegistry')
const FC = await load('fleetCams')
const { api } = await load('api')
const { fleet, reconnectDelay, DEFAULT_FLEET_URL } = await load('fleet')

const node = (goal_id, goal, robot, after = [], state = 'pending') => ({ goal_id, goal, robot, after, state })
const W1 = { type: 'on', object: 'widget', from: 'bench', to: 'crate' }
const W2 = { type: 'go', to: 'dock' }
const plan = (goals, state = 'awaiting_approval') => ({ plan_id: 'p1', text: 'move the widget', state, goals, questions: [], warnings: [] })
const bot = (id, real, state = 'idle') => ({ id, url: `http://${id}`, ...(real === undefined ? {} : { real }), state })

// ── fleetView ─────────────────────────────────────────────────────────────────────────────────────────────
test('fleetView goalLabel: the goal in its own words, empty parts left out', () => {
  assert.equal(FV.goalLabel(W1), 'on widget from bench to crate')
  assert.equal(FV.goalLabel(W2), 'go to dock')
})

test('fleetView groupByRobot: robots in order of their first goal, goals with no robot last', () => {
  const p = plan([node('g1', W1, 'r2'), node('g2', W2, null), node('g3', W2, 'r1'), node('g4', W1, 'r2')])
  assert.deepEqual(FV.groupByRobot(p).map(g => [g.robot, g.goals.map(n => n.goal_id)]), [['r2', ['g1', 'g4']], ['r1', ['g3']], [null, ['g2']]])
})

test('fleetView _empty: a plan with no goals gives no groups, no real robots, no confirmation', () => {
  const p = plan([])
  assert.deepEqual(FV.groupByRobot(p), [])
  assert.deepEqual(FV.realRobotsOf(p, []), [])
  assert.equal(FV.approveConfirm(p, []), '')
  assert.deepEqual(FV.stopLines([]), [])
  assert.deepEqual(FV.lostRobots([]), [])
  assert.deepEqual(FV.mergePlans([], []), [])
})

test('fleetView afterText: starts first, or what it waits for (goal, words, robot); an unknown id is kept', () => {
  const p = plan([node('g1', W1, 'r1'), node('g2', W2, 'r2', ['g1', 'g9'])])
  assert.equal(FV.afterText(p.goals[0], p), 'starts first')
  assert.equal(FV.afterText(p.goals[1], p), 'after g1 (on widget from bench to crate on r1), g9')
})

test('fleetView stateColour: done and failed differ, an unknown state is grey', () => {
  assert.notEqual(FV.stateColour('done'), FV.stateColour('failed'))
  assert.equal(FV.stateColour('lost'), FV.stateColour('lost'))
  assert.equal(FV.stateColour('teleporting'), FV.UNKNOWN_COLOUR)
})

test('fleetView approveConfirm: names every real robot; a sim-only plan needs no confirmation', () => {
  const robots = [bot('r1', false), bot('r2', true), bot('r3', undefined)]
  assert.equal(FV.approveConfirm(plan([node('g1', W1, 'r1')]), robots), '')
  const c = FV.approveConfirm(plan([node('g1', W1, 'r1'), node('g2', W2, 'r2'), node('g3', W2, 'r3')]), robots)
  assert.match(c, /REAL robots: r2, r3\./)              // r3 does not say: real by default (SPEC)
  assert.doesNotMatch(c, /r1/)
})

test('fleetView realRobotsOf: an unknown robot is real; a goal with no robot yet may go to any reachable robot', () => {
  const robots = [bot('r1', false), bot('r2', true), bot('r4', true, 'lost')]
  assert.deepEqual(FV.realRobotsOf(plan([node('g1', W1, 'ghost')]), robots), ['ghost'])
  assert.deepEqual(FV.realRobotsOf(plan([node('g1', W1, 'r1'), node('g2', W2, null)]), robots), ['r2'])
  assert.equal(FV.canApprove(plan([], 'awaiting_approval')), true)
  for (const s of ['understanding', 'running', 'stopped', 'done']) assert.equal(FV.canApprove(plan([], s)), false)
  assert.equal(FV.canApprove(null), false)
})

// regression shaped like the failure class: a Stop that did not stop must never read as a green tick
test('fleetView stopLines: only a cancel that worked and cancelled something is ok; failed / empty / warned / errors warn', () => {
  const lines = FV.stopLines([
    { robot: 'r1', ok: true, cancelled: ['arm', 'base'], errors: {}, warning: '' },
    { robot: 'r2', ok: true, cancelled: [], errors: {}, warning: '' },
    { robot: 'r3', ok: false, cancelled: [], errors: { base: 'timeout' }, warning: 'robot did not answer' },
    { robot: 'r4', ok: true, cancelled: ['arm'], errors: {}, warning: 'goal g2 was running' },
  ])
  assert.deepEqual(lines.map(l => l.level), ['ok', 'warning', 'warning', 'warning'])
  assert.equal(lines[0].text, 'cancelled arm, base')
  assert.match(lines[1].text, /nothing was cancelled/)
  assert.match(lines[2].text, /robot did not answer; the cancel failed; errors: base: timeout/)
  assert.match(lines[3].text, /goal g2 was running/)
  assert.notEqual(FV.stopEmptyWarning([]), '')
  assert.equal(FV.stopEmptyWarning([{ robot: 'r1', ok: true, cancelled: ['arm'], errors: {}, warning: '' }]), '')
})

test('fleetView lostRobots / refreshTargets / mergePlans', () => {
  assert.deepEqual(FV.lostRobots([bot('r1', false), bot('r2', true, 'lost')]).map(r => r.id), ['r2'])
  assert.deepEqual(FV.refreshTargets({ event: 'goal_state', plan_id: 'p1', goal_id: 'g1' }), { plan: 'p1', robots: false })
  assert.deepEqual(FV.refreshTargets({ event: 'goal_state', plan_id: 'p1', robot: 'r1' }), { plan: 'p1', robots: true })
  assert.deepEqual(FV.refreshTargets({ event: 'robot_lost', robot: 'r2' }), { plan: null, robots: true })
  const a = plan([]), b = { ...plan([]), plan_id: 'p2' }
  const merged = FV.mergePlans([a, b], [{ ...a, state: 'running' }, { ...a, plan_id: 'p3' }])
  assert.deepEqual(merged.map(p => [p.plan_id, p.state]), [['p1', 'running'], ['p2', 'awaiting_approval'], ['p3', 'awaiting_approval']])
})

// ── fleet client ──────────────────────────────────────────────────────────────────────────────────────────
const calls = []
const fakeFetch = routes => async (url, init = {}) => {
  const method = init.method ?? 'GET'
  calls.push({ url, method, body: init.body ? JSON.parse(init.body) : undefined })
  const [status, body] = routes(url, method) ?? [404, { detail: 'Not Found' }]
  return new Response(JSON.stringify(body), { status })
}
const withFetch = async (routes, fn) => {
  const orig = globalThis.fetch
  calls.length = 0
  globalThis.fetch = fakeFetch(routes)
  try { await fn() } finally { globalThis.fetch = orig }
}

test('fleet _off / default: no stored URL -> http://localhost:8100', () => {
  globalThis.localStorage = mkStore(); globalThis.sessionStorage = mkStore()
  assert.equal(DEFAULT_FLEET_URL, 'http://localhost:8100')
  assert.equal(fleet.getFleetUrl(), DEFAULT_FLEET_URL)
})

test('fleet URL belongs to one tab; the last one chosen seeds a new tab', () => {
  globalThis.localStorage = mkStore()
  globalThis.sessionStorage = mkStore()
  fleet.setFleetUrl('http://mgr-a:8100/')
  const tabA = globalThis.sessionStorage
  globalThis.sessionStorage = mkStore()
  assert.equal(fleet.getFleetUrl(), 'http://mgr-a:8100')
  fleet.setFleetUrl('http://mgr-b:8100')
  globalThis.sessionStorage = tabA
  assert.equal(fleet.getFleetUrl(), 'http://mgr-a:8100')
})

// rule 6 shaped: what the tab reads when it opens is GET only, and a missing plan list does not hide the robots
test('fleet snapshot / robots / plan: GET only; no plan list (404) is an empty list', async () => {
  globalThis.sessionStorage = mkStore(); globalThis.localStorage = mkStore()
  await withFetch((url, m) => (m === 'GET' && url.endsWith('/fleet/robots') ? [200, [bot('r1', false)]]
    : m === 'GET' && url.endsWith('/fleet/plans/p%2F1') ? [200, plan([])] : null), async () => {
    const s = await fleet.snapshot()
    assert.deepEqual(s.robots.map(r => r.id), ['r1']); assert.deepEqual(s.plans, [])
    assert.equal((await fleet.plan('p/1')).plan_id, 'p1')
    assert.ok(calls.every(c => c.method === 'GET'), JSON.stringify(calls))
    assert.ok(calls.every(c => c.url.startsWith('http://localhost:8100/fleet/')))
  })
})

test('fleet lists: bare or wrapped ({robots}, {plans}, {results}); anything else is empty', async () => {
  const res = [{ robot: 'r1', ok: true, cancelled: ['arm'], errors: {}, warning: '' }]
  await withFetch((url, m) => (url.endsWith('/fleet/robots') ? [200, { robots: [bot('r1', true)] }]
    : url.endsWith('/fleet/plans') ? [200, { plans: [plan([])] }]
    : url.endsWith('/fleet/stop') && m === 'POST' ? [200, { results: res }] : null), async () => {
    assert.equal((await fleet.robots()).length, 1)
    assert.equal((await fleet.plans()).length, 1)
    assert.deepEqual(await fleet.stopAll(), res)
  })
  await withFetch(url => (url.endsWith('/fleet/stop') ? [200, res] : [200, { nothing: 1 }]), async () => {
    assert.deepEqual(await fleet.stopAll(), res)
    assert.deepEqual(await fleet.robots(), [])
  })
})

test('fleet writes: submit / approve / answer / stopAll / releaseLock are POSTs to the SPEC routes with their bodies', async () => {
  await withFetch((url, m) => (m === 'POST' ? [200, url.endsWith('/fleet/requests') ? { plan_id: 'p1', state: 'understanding' } : []] : null), async () => {
    assert.deepEqual(await fleet.submit('move the widget', 'en'), { plan_id: 'p1', state: 'understanding' })
    await fleet.submit('move the widget')
    await fleet.approve('p1', 'ana'); await fleet.answer('p1', 'the blue one'); await fleet.stopAll(); await fleet.releaseLock('bench/left')
  })
  assert.deepEqual(calls.map(c => [c.method, c.url.replace(DEFAULT_FLEET_URL, ''), c.body]), [
    ['POST', '/fleet/requests', { text: 'move the widget', lang: 'en' }],
    ['POST', '/fleet/requests', { text: 'move the widget' }],
    ['POST', '/fleet/plans/p1/approve', { operator: 'ana' }],
    ['POST', '/fleet/plans/p1/answer', { text: 'the blue one' }],
    ['POST', '/fleet/stop', undefined],
    ['POST', '/fleet/locks/bench%2Fleft/release', undefined],
  ])
})

test('fleet: a refused approve (409) throws the manager\'s reason', async () => {
  await withFetch(() => [409, { detail: 'plan p1 is running, not awaiting_approval' }], async () => {
    await assert.rejects(fleet.approve('p1', 'ana'), /not awaiting_approval/)
  })
})

test('fleet reconnectDelay: 1, 2, 4, 8 s, then 10 s', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(reconnectDelay), [1000, 2000, 4000, 8000, 10000, 10000])
})

test('fleet subscribe: /ws/fleet events reach the caller, non-JSON is dropped, it reconnects until close()', async () => {
  const sockets = []
  globalThis.WebSocket = class { constructor(url) { this.url = url; this.closed = false; sockets.push(this) } close() { this.closed = true; this.onclose?.() } }
  globalThis.sessionStorage = mkStore(); globalThis.localStorage = mkStore()
  fleet.setFleetUrl('https://mgr:8100')
  const events = [], status = []
  const sub = fleet.subscribe(e => events.push(e), s => status.push(s), () => 0)
  assert.equal(sockets[0].url, 'wss://mgr:8100/ws/fleet')
  sockets[0].onopen(); sockets[0].onmessage({ data: '{"event":"goal_state","plan_id":"p1"}' }); sockets[0].onmessage({ data: 'hello' })
  sockets[0].onmessage({ data: '{"no_event":1}' })
  assert.deepEqual(events, [{ event: 'goal_state', plan_id: 'p1' }])
  sockets[0].onclose()                                        // the manager restarted
  await new Promise(r => setTimeout(r, 5))
  assert.equal(sockets.length, 2)
  sub.close()
  await new Promise(r => setTimeout(r, 5))
  assert.equal(sockets.length, 2, 'no reconnect after close()')
  assert.deepEqual(status, ['connecting', 'open', 'closed', 'connecting', 'closed'])
})

// ── fleet selector, editor logic, registry and manager sync ─────────────────────────────────────────────────
const fl = (name, ...members) => ({ name, url: `http://${name}:8100`, members: members.map(([n, real]) => ({ name: n, real })) })

test('selector options: robots first, fleets in a second group; values parse back', () => {
  const o = FE_.selectorOptions([{ name: 'ra' }, { name: 'rb' }], [{ name: 'fx' }])
  assert.deepEqual(o.map(x => [x.group, x.value]), [['Robots', 'robot:ra'], ['Robots', 'robot:rb'], ['Fleets', 'fleet:fx']])
  assert.deepEqual(FE_.parseSelection('fleet:fx'), { kind: 'fleet', name: 'fx' })
  assert.deepEqual(FE_.parseSelection('robot:a:b'), { kind: 'robot', name: 'a:b' })
  assert.equal(FE_.parseSelection(''), null)
})

test('draft: Save needs a name, a URL, a unique name and a real/sim choice for EVERY member (no default)', () => {
  let d = FE_.fleetToDraft(null, 'http://m:1')
  assert.match(FE_.draftProblem(d, [], null), /Name/)
  d = { ...d, name: ' f1 ' }
  assert.equal(FE_.draftProblem(d, [], null), null, 'no members is allowed')
  d = FE_.toggleMember(d, 'ra')
  assert.deepEqual(d.members, [{ name: 'ra', real: null }])
  assert.match(FE_.draftProblem(d, [], null), /ra/, 'disabled until chosen')
  d = FE_.setMemberReal(d, 'ra', false)                       // simulated is a choice too
  assert.equal(FE_.draftProblem(d, [], null), null)
  assert.deepEqual(FE_.draftToFleet({ ...d, url: 'http://m:1//' }), { name: 'f1', url: 'http://m:1', members: [{ name: 'ra', real: false }] })
  assert.match(FE_.draftProblem(d, [fl('f1')], null), /already exists/)
  assert.equal(FE_.draftProblem(d, [fl('f1')], 'f1'), null, 'editing keeps its own name')
  assert.match(FE_.draftProblem({ ...d, url: ' ' }, [], null), /URL/)
  assert.equal(FE_.toggleMember(d, 'ra').members.length, 0)
})

test('diffConfig: PUT every member, DELETE the manager robots that are not members', () => {
  const urls = { ra: 'http://a', rb: 'http://b' }
  const cfg = { robots: [{ id: 'ra', url: 'http://old', real: true }, { id: 'rz', url: 'http://z', real: true }] }
  const d = FE_.diffConfig(fl('f', ['ra', false], ['rb', true]), cfg, n => urls[n])
  assert.deepEqual(d.put, [{ id: 'ra', body: { url: 'http://a', real: false } }, { id: 'rb', body: { url: 'http://b', real: true } }])
  assert.deepEqual(d.del, ['rz'])
  assert.deepEqual(FE_.diffConfig(fl('f', ['rq', true]), { robots: [] }, () => undefined).missing, ['rq'])
})

test('a robot removed from the registry leaves its fleets; a renamed one is followed', () => {
  const fs = [fl('f1', ['ra', true], ['rb', false]), fl('f2', ['rb', true])]
  assert.deepEqual(FE_.fleetsUsing(fs, 'ra'), ['f1'])
  assert.deepEqual(FE_.dropRobot(fs, 'rb').map(f => f.members.length), [1, 0])
  assert.deepEqual(FE_.renameRobot(fs, 'ra', 'rc')[0].members[0], { name: 'rc', real: true })
})

test('registry: fleets in localStorage; the active fleet is per tab and gives the manager URL', () => {
  globalThis.localStorage = mkStore(); globalThis.sessionStorage = mkStore()
  assert.deepEqual(FR.listFleets(), [])
  FR.saveFleet(null, fl('f1', ['ra', true])); FR.saveFleet(null, fl('f2'))
  assert.deepEqual(FR.listFleets().map(f => f.name), ['f1', 'f2'])
  assert.equal(fleet.getFleetUrl(), DEFAULT_FLEET_URL, 'no fleet selected: the plain per-tab URL')
  FR.setActiveFleet('f2')
  assert.equal(fleet.getFleetUrl(), 'http://f2:8100')
  fleet.setFleetUrl('http://other:9/')                         // the tab's "Use" box edits the selected fleet
  assert.equal(FR.listFleets()[1].url, 'http://other:9')
  FR.saveFleet('f2', fl('f3'))                                 // rename follows the active fleet
  assert.equal(FR.getActiveFleetName(), 'f3')
  FR.followRobot('ra', 'rz'); assert.equal(FR.listFleets()[0].members[0].name, 'rz')
  FR.forgetRobot('rz'); assert.equal(FR.listFleets()[0].members.length, 0)
  FR.removeFleet('f3')
  assert.equal(FR.getActiveFleetName(), '')
  assert.deepEqual(FR.listFleets().map(f => f.name), ['f1'])
  assert.equal(fleet.getFleetUrl(), DEFAULT_FLEET_URL)
})

test('syncFleet: PUTs the members, DELETEs the others, reports the manager text (409) ', async () => {
  const f = fl('f', ['ra', true], ['rb', false])
  const urlOf = n => ({ ra: 'http://a', rb: 'http://b' })[n]
  const cfg = { robots: [{ id: 'ra', url: 'http://a', real: true }, { id: 'rz', url: 'http://z', real: true }, { id: 'ry', url: 'http://y', real: true }] }
  await withFetch((url, m) => {
    if (m === 'GET') return [200, cfg]
    if (url.endsWith('/rz')) return [409, { detail: 'goal g1 is running on rz' }]
    return [200, {}]
  }, async () => {
    const r = await fleet.syncFleet(f, urlOf)
    assert.deepEqual(calls.map(c => [c.method, c.url.replace('http://f:8100', '')]),
      [['GET', '/fleet/config'], ['PUT', '/fleet/robots/ra'], ['PUT', '/fleet/robots/rb'], ['DELETE', '/fleet/robots/rz'], ['DELETE', '/fleet/robots/ry']])
    assert.deepEqual(calls[2].body, { url: 'http://b', real: false })
    assert.equal(r.state, 'error')
    assert.match(r.text, /rz: goal g1 is running on rz/)
  })
  await withFetch(() => [200, { robots: [] }], async () => {
    assert.deepEqual(await fleet.syncFleet(f, urlOf), { state: 'synced', text: 'synced' })
  })
})

test('syncFleet: an unreachable manager is "not synced", nothing else is sent', async () => {
  const orig = globalThis.fetch
  let n = 0
  globalThis.fetch = async () => { n++; throw new TypeError('Failed to fetch') }
  try {
    const r = await fleet.syncFleet(fl('f', ['ra', true]), () => 'http://a')
    assert.equal(r.state, 'not_synced')
    assert.match(r.text, /^not synced/)
    assert.equal(n, 1)
  } finally { globalThis.fetch = orig }
})

// ── fleetCams: the camera grid ───────────────────────────────────────────────────────────────────────────
const ent = (id, is_camera, name = '') => ({ id, name, is_camera, type: 'webrtc', config: {}, connected: true, is_active: false, error: '', last_checked: 0 })
test('fleetCams: options keep only cameras, in order; default is the first, a remembered one wins only if it still exists', () => {
  const o = FC.cameraOptions([ent('arm', false), ent('c1', true, 'Front'), ent('c2', true)])
  assert.deepEqual(o, [{ id: 'c1', label: 'Front' }, { id: 'c2', label: 'c2' }])
  assert.equal(FC.pickCamera(o), 'c1')
  assert.equal(FC.pickCamera(o, 'c2'), 'c2')
  assert.equal(FC.pickCamera(o, 'gone'), 'c1')
  assert.equal(FC.pickCamera([], 'c2'), null)
})
test('fleetCams: tile states are plain, never loading for ever', () => {
  assert.equal(FC.tileState(null, false), 'loading')
  assert.equal(FC.tileState(null, true), 'unreachable')
  assert.equal(FC.tileState([], false), 'no_camera')
  assert.equal(FC.tileState([{ id: 'a', label: 'a' }], false), 'ready')
  assert.match(FC.tileMessage('unreachable', 'http://r1'), /Cannot reach the robot at http:\/\/r1/)
  assert.match(FC.tileMessage('no_camera', 'http://r1'), /no camera/)
})
test('fleetCams: choices are remembered per robot id; a broken store gives {}', () => {
  FC.rememberChoice('r1', 'c2'); FC.rememberChoice('r2', 'c9')
  assert.deepEqual(FC.loadChoices(), { r1: 'c2', r2: 'c9' })
  sessionStorage.setItem(FC.LS_FLEET_CAMS, '[1]')
  assert.deepEqual(FC.loadChoices(), {})
  sessionStorage.setItem(FC.LS_FLEET_CAMS, 'not json')
  assert.deepEqual(FC.loadChoices(), {})
})
test('api: listClientsAt / cameraWsAt use the given robot; listClients / cameraWs keep using the active robot', async () => {
  const seen = []
  const realFetch = globalThis.fetch, RealWS = globalThis.WebSocket
  globalThis.fetch = async (u, init) => { seen.push([u, init]); return { ok: !String(u).startsWith('http://bad'), status: 503, json: async () => [ent('c1', true)] } }
  globalThis.WebSocket = class { constructor(u) { seen.push(u) } }
  try {
    assert.equal((await api.listClientsAt('http://other:1')).length, 1)
    assert.equal(seen[0][0], 'http://other:1/connects')
    await assert.rejects(api.listClientsAt('http://bad:1'), /HTTP 503/)
    assert.deepEqual(await api.listClients().then(() => 'ok'), 'ok')
    assert.equal(seen[2][0], `${api.getAgentUrl()}/connects`)
    assert.equal(seen[2][1], undefined)
    api.cameraWsAt('https://other:1', 'c1'); api.cameraWs('c1')
    assert.equal(seen[3], 'wss://other:1/ws/camera/c1')
    assert.equal(seen[4], `${api.getAgentUrl().replace('http://', 'ws://')}/ws/camera/c1`)
  } finally { globalThis.fetch = realFetch; globalThis.WebSocket = RealWS }
})
