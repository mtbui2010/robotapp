#!/usr/bin/env node
// Unit tests of lib/repeatPolicy.ts (what a repeat loop does after a run: pure, made-up cases). Run: make unit
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
const out = mkdtempSync(join(tmpdir(), 'robotapp-repeat-'))
const outfile = join(out, 'repeatPolicy.mjs')
buildSync({ entryPoints: [join(FE, 'lib', 'repeatPolicy.ts')], outfile, bundle: true, format: 'esm', platform: 'node', logLevel: 'error' })
const R = await import(pathToFileURL(outfile).href)

// nextStep(policy, ok, remaining AFTER this run, active)
test('ask: after every run that is not the last, success or failure alike', () => {
  assert.equal(R.nextStep('ask', true, 2, true), 'ask')
  assert.equal(R.nextStep('ask', false, 2, true), 'ask')
  assert.equal(R.nextStep('ask', true, 1, true), 'ask')
})

test('ask: forever (Infinity) asks after every run', () => {
  assert.equal(R.nextStep('ask', true, Infinity, true), 'ask')
  assert.equal(R.nextStep('ask', false, Infinity - 1, true), 'ask')
})

test('stop: continues while runs succeed, ends at the first failure', () => {
  assert.equal(R.nextStep('stop', true, 2, true), 'next')
  assert.equal(R.nextStep('stop', false, 2, true), 'end')
  assert.equal(R.nextStep('stop', true, Infinity, true), 'next')
})

test('continue: always next, failure or not', () => {
  assert.equal(R.nextStep('continue', true, 2, true), 'next')
  assert.equal(R.nextStep('continue', false, 2, true), 'next')
})

test('an exhausted count ends the loop in every policy and never asks', () => {
  for (const p of ['ask', 'stop', 'continue']) for (const ok of [true, false]) {
    assert.equal(R.nextStep(p, ok, 0, true), 'end', `${p} ok=${ok}`)
    assert.equal(R.nextStep(p, ok, -1, true), 'end')
  }
})

test('a user Stop / Cancel or a socket loss (inactive) ends the loop and never asks', () => {
  for (const p of ['ask', 'stop', 'continue']) for (const ok of [true, false]) {
    assert.equal(R.nextStep(p, ok, 5, false), 'end', `${p} ok=${ok}`)
    assert.equal(R.nextStep(p, ok, Infinity, false), 'end')
  }
})

test('an unknown policy value is treated as ask', () => {
  assert.equal(R.nextStep('weird', true, 2, true), 'ask')
  assert.equal(R.nextStep(undefined, false, 2, true), 'ask')
})

test('migratePolicy: the new key wins over the old one', () => {
  assert.equal(R.migratePolicy('stop', '1'), 'stop')
  assert.equal(R.migratePolicy('continue', '0'), 'continue')
  assert.equal(R.migratePolicy('ask', '1'), 'ask')
})

test('migratePolicy: old key 1 -> continue, 0 -> stop', () => {
  assert.equal(R.migratePolicy(null, '1'), 'continue')
  assert.equal(R.migratePolicy(null, '0'), 'stop')
  assert.equal(R.migratePolicy(undefined, '1'), 'continue')
})

test('migratePolicy: neither key or anything else -> ask', () => {
  assert.equal(R.migratePolicy(null, null), 'ask')
  assert.equal(R.migratePolicy(undefined, undefined), 'ask')
  assert.equal(R.migratePolicy('', ''), 'ask')
  assert.equal(R.migratePolicy('bogus', 'yes'), 'ask')
  assert.equal(R.migratePolicy(null, 'true'), 'ask')
  assert.equal(R.migratePolicy('bogus', '1'), 'ask')   // a stored but invalid new value wins and is not trusted: ask
})

test('constants: the storage keys and the default', () => {
  assert.equal(R.LS_REPEAT_ON_FAIL, 'robotapp_repeat_on_fail')
  assert.equal(R.LS_REPEAT_COE_OLD, 'robotapp_repeat_continue_on_error')
  assert.equal(R.DEFAULT_POLICY, 'ask')
  assert.deepEqual([...R.POLICIES], ['ask', 'stop', 'continue'])
})
