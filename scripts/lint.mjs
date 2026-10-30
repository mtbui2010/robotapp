#!/usr/bin/env node
// Repo-rule checks for the frontend (CLAUDE.md rules 1-3), no dependencies.
// ESLint is run too when it is installed in frontend/node_modules (it is not
// today: package.json has no eslint; `next build` skips its lint step).
//
//   1. Endpoints: every robot_agent path built in frontend/lib/api.ts exists in
//      frontend/lib/generated/openapi.json (scripts/gen_types.sh); /ws/* are
//      WebSocket routes, which OpenAPI does not list.
//   2. Only lib/api.ts talks HTTP: a fetch() / new WebSocket() elsewhere must
//      take a URL from an `api.` helper.
//   3. Bundled robot data: a .json under frontend/lib imported by the UI must be
//      in BUNDLED_ALLOWED (each one is listed in docs/backend_coupling.md). Do
//      not add to it: get the data from the backend instead.
//   4. Backend workarounds: every `BACKEND-WORKAROUND(<id>)` tag in the code has
//      its <id> in docs/backend_coupling.md, so none goes unlisted.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FE = join(ROOT, 'frontend')
const BUNDLED_ALLOWED = new Set(['lib/skill_configs.json', 'lib/ros_templates.json'])
const errors = []
const err = (file, line, msg) => errors.push(`${relative(ROOT, file)}:${line}: ${msg}`)

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.') || name === 'out') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}
const sources = ['app', 'components', 'lib'].flatMap(d => walk(join(FE, d)))
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length

// 1. endpoints vs OpenAPI
const specPath = join(FE, 'lib/generated/openapi.json')
if (!existsSync(specPath)) {
  console.log('lint: no frontend/lib/generated/openapi.json (scripts/gen_types.sh) — endpoint check skipped')
} else {
  const spec = JSON.parse(readFileSync(specPath, 'utf8'))
  const toRe = p => new RegExp('^' + p.replace(/[.*+?^$()|[\]\\]/g, '\\$&')
    .replace(/\{(?:[^}]+:path|path|cid|connect_id)\}/g, '.+')   // FastAPI drops `:path` from OpenAPI
    .replace(/\{[^}]+\}/g, '[^/]+') + '$')
  const known = Object.keys(spec.paths).map(p => [p, toRe(p)])
  const apiFile = join(FE, 'lib/api.ts')
  const text = readFileSync(apiFile, 'utf8')
  const re = /\$\{get(?:AgentUrl|WsBase)\(\)\}(\/[^`?]*)/g
  let m, n = 0
  while ((m = re.exec(text))) {
    n += 1
    // `${...}` segments → one placeholder segment; a `.join('/')` path → many
    const path = m[1].replace(/([^/])\$\{[^}]*\}$/, '$1')    // trailing `${q}`: a query string
      .replace(/\$\{[^}]*join\('\/'\)\}/g, 'x/y').replace(/\$\{[^}]*\}/g, 'x')
    if (path.startsWith('/ws/')) continue
    if (!known.some(([, r]) => r.test(path))) err(apiFile, lineOf(text, m.index), `${m[1]} is not in robot_agent's OpenAPI`)
  }
  console.log(`lint: ${n} endpoint URLs in lib/api.ts checked against ${known.length} OpenAPI paths`)
}

for (const file of sources) {
  const rel = relative(FE, file)
  const text = readFileSync(file, 'utf8')
  // 2. HTTP outside lib/api.ts
  if (rel !== 'lib/api.ts') {
    const re = /\b(fetch|new WebSocket)\(\s*([^,)\s]*)/g
    let m
    while ((m = re.exec(text))) {
      if (!m[2].startsWith('api.')) err(file, lineOf(text, m.index), `${m[1]}() outside lib/api.ts — add a wrapper there`)
    }
  }
  // 3. bundled JSON
  const imp = /import\s+\w+\s+from\s+['"]([^'"]+\.json)['"]/g
  let m
  while ((m = imp.exec(text))) {
    const target = relative(FE, join(dirname(file), m[1]))
    if (!BUNDLED_ALLOWED.has(target)) err(file, lineOf(text, m.index), `bundles ${target}: robot data must come from the backend (rule 2)`)
  }
}

// 4. workaround tags are inventoried
const coupling = existsSync(join(ROOT, 'docs/backend_coupling.md')) ? readFileSync(join(ROOT, 'docs/backend_coupling.md'), 'utf8') : ''
let tags = 0
for (const file of sources) {
  const text = readFileSync(file, 'utf8')
  const re = /BACKEND-WORKAROUND\(([\w-]+)\)/g
  let m
  while ((m = re.exec(text))) {
    tags += 1
    if (!coupling.includes(m[1])) err(file, lineOf(text, m.index), `workaround ${m[1]} is not listed in docs/backend_coupling.md`)
  }
}
console.log(`lint: ${sources.length} files, ${tags} BACKEND-WORKAROUND tags`)

// ESLint, when installed
const eslint = join(FE, 'node_modules/.bin/eslint')
if (existsSync(eslint)) {
  const r = spawnSync(join(FE, 'node_modules/.bin/next'), ['lint'], { cwd: FE, stdio: 'inherit' })
  if (r.status !== 0) errors.push('next lint failed')
} else {
  console.log('lint: eslint not installed in frontend/node_modules — skipped (npm i -D eslint eslint-config-next to enable)')
}

if (errors.length) {
  console.error(errors.join('\n'))
  console.error(`lint: ${errors.length} problem(s)`)
  process.exit(1)
}
console.log('lint: ok')
