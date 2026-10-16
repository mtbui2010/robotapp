'use client'
// Servers of one AI connection (vlms / visions / voices), in fallback order: the first usable one serves each
// call, the next takes over when it fails or runs on the CPU (robot_agent/connect/pool.py).
import type { PoolKind, PoolServerStatus } from '../lib/types'

export type Provider = 'ollama' | 'openai' | 'gemini' | 'anthropic'

export interface ServerRow {
  provider: Provider     // vlms only
  url: string
  model: string
  numCtx: string         // Ollama context window, sent with every request
  slowSec: string        // slower than this = on the CPU (blank = the kind's default)
  enabled: boolean
  apiKey: string         // typed here, saved to the site's .env (never into connections.json)
}

export const PROVIDER_LABEL: Record<Provider, string> = {
  ollama: 'Ollama', openai: 'ChatGPT (OpenAI)', gemini: 'Gemini', anthropic: 'Claude (Anthropic)',
}
const MODEL_HINT: Record<Provider, string> = {
  ollama: 'qwen3-vl:8b-instruct', openai: 'gpt-4.1-mini', gemini: 'gemini-2.5-flash', anthropic: 'claude-haiku-5-5',
}
export const KIND_DEFAULT_NAME: Record<PoolKind, string> = { vlms: 'vlm', visions: 'visionserve', voices: 'whisper' }
const SLOW_DEFAULT: Record<PoolKind, number> = { vlms: 20, visions: 8, voices: 5 }

const blank = (p: Partial<ServerRow> = {}): ServerRow => ({
  provider: 'ollama', url: '', model: '', numCtx: '', slowSec: '', enabled: true, apiKey: '', ...p,
})

export function defaultRows(kind: PoolKind): ServerRow[] {
  if (kind === 'vlms') return [blank({ url: 'http://192.168.0.6:11434', model: 'qwen3-vl:8b-instruct', numCtx: '8192' })]
  if (kind === 'visions') return [blank({ url: 'http://192.168.0.6:11435' })]
  return [blank({ url: 'http://192.168.0.6:8000', model: 'deepdml/faster-whisper-large-v3-turbo-ct2' })]
}

export function rowsFromConfig(cfg: Record<string, unknown>): ServerRow[] {
  const list = Array.isArray(cfg.servers) ? (cfg.servers as Record<string, unknown>[]) : []
  return list.map(s => blank({
    provider: (String(s.provider ?? 'ollama') as Provider),
    url: String(s.url ?? ''),
    model: String(s.model ?? ''),
    numCtx: s.num_ctx != null ? String(s.num_ctx) : '',
    slowSec: s.slow_sec != null ? String(s.slow_sec) : '',
    enabled: s.enabled !== false,
  }))
}

export function rowsToConfig(kind: PoolKind, rows: ServerRow[]): Record<string, unknown>[] {
  return rows.map(r => {
    const s: Record<string, unknown> = { enabled: r.enabled }
    const cloud = kind === 'vlms' && r.provider !== 'ollama'
    if (kind === 'vlms') s.provider = r.provider
    if (!cloud && r.url.trim()) s.url = r.url.trim()
    if (r.model.trim() && kind !== 'visions') s.model = r.model.trim()
    if (kind === 'vlms' && r.provider === 'ollama' && parseInt(r.numCtx) > 0) s.num_ctx = parseInt(r.numCtx)
    if (parseFloat(r.slowSec) > 0) s.slow_sec = parseFloat(r.slowSec)
    return s
  })
}

/** The first problem with the rows, or null — the backend checks the same (pool.normalize_servers). */
export function rowsError(kind: PoolKind, rows: ServerRow[]): string | null {
  if (!rows.length) return 'Add at least one server'
  for (const [i, r] of rows.entries()) {
    const cloud = kind === 'vlms' && r.provider !== 'ollama'
    if (!cloud && !r.url.trim()) return `Server #${i + 1}: url is required`
    if (cloud && !r.model.trim()) return `Server #${i + 1}: model is required`
  }
  return null
}

export const STATUS_DOT: Record<string, string> = {
  ok: 'bg-green-500', slow: 'bg-amber-400', down: 'bg-red-400', unknown: 'bg-gray-300', off: 'bg-gray-200',
}

const inputCls = 'bg-white border border-gray-200 text-gray-800 rounded px-2 py-1 font-mono placeholder-gray-400 min-w-0'

export default function ServerListEditor({ kind, rows, onChange, keysSaved, status }: {
  kind: PoolKind
  rows: ServerRow[]
  onChange: (rows: ServerRow[]) => void
  keysSaved: Record<string, boolean>
  status?: PoolServerStatus[]
}) {
  const set = (i: number, p: Partial<ServerRow>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)))
  const move = (i: number, d: -1 | 1) => {
    const j = i + d
    if (j < 0 || j >= rows.length) return
    const next = [...rows]
    ;[next[i], next[j]] = [next[j], next[i]]
    onChange(next)
  }
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-gray-500">
        Servers <span className="text-gray-400">— in fallback order: #1 is the main one; the next takes over when
        it fails or runs on the CPU</span>
      </span>
      {rows.map((r, i) => {
        const cloud = kind === 'vlms' && r.provider !== 'ollama'
        const st = status?.[i]
        return (
          <div key={i} className={`border rounded p-1.5 flex flex-col gap-1 ${r.enabled ? 'border-gray-200 bg-white' : 'border-dashed border-gray-200 bg-gray-50 opacity-70'}`}>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-semibold text-gray-500 w-5">#{i + 1}</span>
              {st && <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[st.status] ?? 'bg-gray-300'}`}
                title={st.error || st.status} />}
              {kind === 'vlms' && (
                <select value={r.provider} onChange={e => set(i, { provider: e.target.value as Provider })}
                  className="bg-white border border-gray-200 text-gray-800 rounded px-1 py-0.5 text-[11px]">
                  {(Object.keys(PROVIDER_LABEL) as Provider[]).map(p => <option key={p} value={p}>{PROVIDER_LABEL[p]}</option>)}
                </select>
              )}
              <label className="flex items-center gap-1 text-[10px] text-gray-500 ml-auto cursor-pointer"
                title="A disabled server is kept in the list but never called">
                <input type="checkbox" checked={r.enabled} onChange={e => set(i, { enabled: e.target.checked })} />
                on
              </label>
              <button onClick={() => move(i, -1)} disabled={i === 0} title="Earlier in the fallback order"
                className="px-1 text-gray-500 hover:text-blue-600 disabled:opacity-30">▲</button>
              <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} title="Later in the fallback order"
                className="px-1 text-gray-500 hover:text-blue-600 disabled:opacity-30">▼</button>
              <button onClick={() => onChange(rows.filter((_, j) => j !== i))} title="Remove this server"
                className="px-1 text-gray-400 hover:text-red-500 text-sm leading-none">×</button>
            </div>
            {!cloud && (
              <input placeholder={kind === 'vlms' ? 'url  e.g. http://192.168.0.6:11434'
                : kind === 'visions' ? 'url  e.g. http://192.168.0.6:11435' : 'url  e.g. http://192.168.0.6:8000'}
                value={r.url} onChange={e => set(i, { url: e.target.value })} className={inputCls} />
            )}
            {kind !== 'visions' && (
              <input placeholder={kind === 'vlms' ? `model  e.g. ${MODEL_HINT[r.provider]}`
                : 'model  e.g. deepdml/faster-whisper-large-v3-turbo-ct2 (a smaller one needs less GPU)'}
                value={r.model} onChange={e => set(i, { model: e.target.value })} className={inputCls} />
            )}
            <div className="flex gap-1">
              {kind === 'vlms' && r.provider === 'ollama' && (
                <input placeholder="num_ctx  e.g. 8192" value={r.numCtx}
                  onChange={e => set(i, { numCtx: e.target.value.replace(/[^0-9]/g, '') })}
                  className={`${inputCls} flex-1`} />
              )}
              <input placeholder={`slow after s  (default ${SLOW_DEFAULT[kind]})`} value={r.slowSec}
                onChange={e => set(i, { slowSec: e.target.value.replace(/[^0-9.]/g, '') })}
                title={kind === 'vlms'
                  ? 'An answer slower than this makes the robot check whether Ollama put the model on the CPU'
                  : 'Two calls in a row slower than this = on the CPU: the next server takes over for a while'}
                className={`${inputCls} flex-1`} />
            </div>
            {cloud && (
              <div className="flex items-center gap-1.5">
                <input type="password" value={r.apiKey} onChange={e => set(i, { apiKey: e.target.value })}
                  placeholder={keysSaved[r.provider] ? '••••••  (key saved — blank keeps it)' : `${PROVIDER_LABEL[r.provider]} API key`}
                  className={`${inputCls} flex-1`} />
                {keysSaved[r.provider] && <span className="text-[10px] text-green-600 whitespace-nowrap">✓ saved</span>}
              </div>
            )}
            {st && (st.error || st.cooldown > 0) && (
              <span className="text-[10px] text-red-500 break-words">
                {st.error}{st.cooldown > 0 ? ` · skipped for ${st.cooldown} s more` : ''}
              </span>
            )}
          </div>
        )
      })}
      <button onClick={() => onChange([...rows, blank()])}
        className="self-start px-2 py-0.5 text-[11px] bg-gray-200 hover:bg-gray-300 text-gray-700 rounded">
        + server
      </button>
      {kind === 'vlms' && rows.some(r => r.provider !== 'ollama') && (
        <span className="text-[10px] text-gray-500">
          A cloud server gets the robot&apos;s photos. API keys are saved in this site&apos;s .env, not in the
          connection.
        </span>
      )}
    </div>
  )
}
