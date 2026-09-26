// Dev-only Evidence tab fixture mode (`[mesh-fast-dev-loop]`).
//
// `VITE_EVIDENCE_FIXTURES=<run>` makes `vite dev` answer `/api/*` from
// `src/features/capsules/__fixtures__/<run>/` (or from `<run>` itself when it
// is a path, so several worktrees can share one captured set), so the Evidence tab renders a
// real captured run with no node running and every copy/layout edit is a hot
// reload. `VITE_EVIDENCE_FIXTURES_RECORD=<run>` (with `MESH_UI_API_ORIGIN`
// pointing at a live node's console port) does the reverse: GETs pass through
// to the node and each response is written into that fixture set.
//
// A request with no captured response is answered 404 with a JSON body naming
// the miss and logged once, never synthesised: a fixture that invents data
// would hide exactly the defects the tab exists to show.
//
// This file is dev-server wiring only; it is never part of the built bundle.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { PluginOption } from 'vite'

export const FIXTURES_ROOT = 'src/features/capsules/__fixtures__'

/** A bare name is a set under FIXTURES_ROOT; anything with a slash is a path. */
export function fixtureDir(viteRoot: string, run: string): string {
  return run.includes('/') ? path.resolve(run) : path.resolve(viteRoot, FIXTURES_ROOT, run)
}

export type FixtureEntry = { file: string; status: number; contentType: string }
export type FixtureManifest = { captured_from?: string; captured_at?: string; entries: Record<string, FixtureEntry> }

/** Same scheme as `scripts/capture-evidence-fixtures.mjs`: the manifest key is
 *  the request path plus its query string, verbatim. */
export function fixtureKey(url: string): string {
  const parsed = new URL(url, 'http://fixture.invalid')
  return `${parsed.pathname}${parsed.search}`
}

export function fixtureFileName(key: string, contentType: string): string {
  const stem = key
    .replace(/^\/api\//, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .slice(0, 80)
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 12)
  const ext = contentType.includes('json') ? '.json' : contentType.startsWith('text/') ? '.txt' : '.bin'
  return `${stem}-${digest}${ext}`
}

function readManifest(dir: string): FixtureManifest {
  const file = path.join(dir, 'manifest.json')
  if (!fs.existsSync(file)) return { entries: {} }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as FixtureManifest
}

function writeManifest(dir: string, manifest: FixtureManifest) {
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

export function replay(dir: string, run: string) {
  const misses = new Set<string>()
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/api/')) return next()
    const key = fixtureKey(req.url)
    // Re-read per request so a re-capture shows up without restarting Vite.
    const entry = readManifest(dir).entries[`${req.method ?? 'GET'} ${key}`]
    if (!entry) {
      if (!misses.has(key)) {
        misses.add(key)
        console.warn(`[evidence-fixtures] ${run}: no fixture for ${req.method} ${key}`)
      }
      res.statusCode = 404
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'evidence fixture mode: not captured', run, request: `${req.method} ${key}` }))
      return
    }
    res.statusCode = entry.status
    res.setHeader('content-type', entry.contentType)
    res.end(fs.readFileSync(path.join(dir, entry.file)))
  }
}

function record(dir: string, run: string, origin: string) {
  fs.mkdirSync(dir, { recursive: true })
  return async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!req.url?.startsWith('/api/') || req.method !== 'GET') return next()
    // Streams (SSE) are live-only; hand them to the ordinary proxy.
    if ((req.headers.accept ?? '').includes('text/event-stream')) return next()
    const key = fixtureKey(req.url)
    let upstream: Response
    try {
      upstream = await fetch(`${origin}${req.url}`)
    } catch (error) {
      res.statusCode = 502
      res.end(`evidence fixture record: upstream fetch failed: ${String(error)}`)
      return
    }
    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream'
    const raw = Buffer.from(await upstream.arrayBuffer())
    const body = contentType.includes('json') ? Buffer.from(scrubJsonText(raw.toString('utf8'))) : raw
    const file = fixtureFileName(key, contentType)
    fs.writeFileSync(path.join(dir, file), body)
    const manifest = readManifest(dir)
    manifest.captured_from = 'vite record mode'
    manifest.captured_at = new Date().toISOString()
    manifest.entries[`GET ${key}`] = { file, status: upstream.status, contentType }
    writeManifest(dir, manifest)
    console.info(`[evidence-fixtures] ${run}: recorded GET ${key} (${upstream.status})`)
    res.statusCode = upstream.status
    res.setHeader('content-type', contentType)
    res.end(body)
  }
}

// Fields whose values are credentials or host-identifying and must never be
// written into a fixture (a set may be committed to a public repo). Mirrors
// SCRUB_KEYS in scripts/capture-evidence-fixtures.mjs.
const SCRUB_KEYS = new Set(['token', 'invite_token', 'join_token', 'api_key', 'secret', 'password', 'my_hostname'])

export function scrubJsonText(text: string): string {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return text
  }
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk)
    if (node && typeof node === 'object') {
      return Object.fromEntries(
        Object.entries(node as Record<string, unknown>).map(([k, v]) => [
          k,
          SCRUB_KEYS.has(k) && typeof v === 'string' ? '<scrubbed-in-fixture>' : walk(v)
        ])
      )
    }
    return node
  }
  return JSON.stringify(walk(value), null, 2)
}

export function evidenceFixtures(): PluginOption {
  const replayRun = process.env.VITE_EVIDENCE_FIXTURES
  const recordRun = process.env.VITE_EVIDENCE_FIXTURES_RECORD
  if (!replayRun && !recordRun) return null
  return {
    name: 'mesh-llm:evidence-fixtures',
    apply: 'serve',
    // The tab's own chrome says "Live"; say on every page what is actually
    // being served, so a fixture screenshot cannot pass for a live node.
    transformIndexHtml() {
      const label = recordRun
        ? `recording fixtures: ${path.basename(recordRun)}`
        : `fixture data: ${path.basename(replayRun as string)}`
      return [
        {
          tag: 'div',
          attrs: {
            'data-evidence-fixture-badge': '',
            style:
              'position:fixed;left:8px;bottom:8px;z-index:2147483647;padding:2px 8px;border-radius:4px;font:600 11px/18px ui-monospace,monospace;background:#7c2d12;color:#fff;pointer-events:none'
          },
          children: label,
          injectTo: 'body'
        }
      ]
    },
    configureServer(server) {
      if (recordRun) {
        const origin = process.env.MESH_UI_API_ORIGIN
        if (!origin)
          throw new Error(
            'VITE_EVIDENCE_FIXTURES_RECORD needs MESH_UI_API_ORIGIN (a live console, e.g. http://127.0.0.1:3501)'
          )
        server.middlewares.use(record(fixtureDir(server.config.root, recordRun), recordRun, origin))
        return
      }
      const dir = fixtureDir(server.config.root, replayRun as string)
      if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
        throw new Error(`VITE_EVIDENCE_FIXTURES=${replayRun}: no ${dir}/manifest.json`)
      }
      server.middlewares.use(replay(dir, replayRun as string))
    }
  }
}
