#!/usr/bin/env node
// Captures one live node's Evidence tab data into a fixture set that
// `VITE_EVIDENCE_FIXTURES=<run> pnpm dev` replays (`[mesh-fast-dev-loop]`).
//
//   node scripts/capture-evidence-fixtures.mjs <console-origin> <run> [extra-path ...]
//   node scripts/capture-evidence-fixtures.mjs http://127.0.0.1:3501 freeze-candidate
//   node scripts/capture-evidence-fixtures.mjs http://127.0.0.1:3501 ../../../_work/fixtures/freeze-candidate
//
// <run> is a set name under src/features/capsules/__fixtures__/, or a path
// (anything containing a slash) for a set kept outside the repo.
//
// Read-only: GETs only, against the node's console port. Enumerates the panes,
// every pane-C drilldown, the ledger, and each record's signed statement and
// disclosure, so a replay never depends on which rows someone happened to
// click while recording. Extra paths (as printed by a replay miss) are added
// verbatim. Credentials and the status host name are scrubbed before anything
// is written. Sealed records are kept byte-exact (the tab recomputes their ids
// and verifies their signatures), so whatever a record sealed -- a hostname, a
// binary path -- stays in the fixture: read a set before committing it.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURES_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/features/capsules/__fixtures__'
)
// Mirrors SCRUB_KEYS in src/lib/dev/evidence-fixtures-plugin.ts.
const SCRUB_KEYS = new Set(['token', 'invite_token', 'join_token', 'api_key', 'secret', 'password', 'my_hostname'])

const [origin, run, ...extraPaths] = process.argv.slice(2)
if (!origin || !run) {
  console.error('usage: capture-evidence-fixtures.mjs <console-origin> <run> [extra-path ...]')
  process.exit(2)
}
const dir = run.includes('/') ? path.resolve(run) : path.join(FIXTURES_ROOT, run)
fs.mkdirSync(dir, { recursive: true })
const manifestFile = path.join(dir, 'manifest.json')
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { entries: {} }

function fixtureKey(url) {
  const parsed = new URL(url, 'http://fixture.invalid')
  return `${parsed.pathname}${parsed.search}`
}

function fixtureFileName(key, contentType) {
  const stem = key
    .replace(/^\/api\//, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .slice(0, 80)
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 12)
  const ext = contentType.includes('json') ? '.json' : contentType.startsWith('text/') ? '.txt' : '.bin'
  return `${stem}-${digest}${ext}`
}

function scrub(node) {
  if (Array.isArray(node)) return node.map(scrub)
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node).map(([k, v]) => [
        k,
        SCRUB_KEYS.has(k) && typeof v === 'string' ? '<scrubbed-in-fixture>' : scrub(v)
      ])
    )
  }
  return node
}

async function capture(urlPath) {
  const key = fixtureKey(urlPath)
  const response = await fetch(`${origin}${urlPath}`)
  const contentType = response.headers.get('content-type') ?? 'application/octet-stream'
  let body = Buffer.from(await response.arrayBuffer())
  let parsed = null
  if (contentType.includes('json')) {
    try {
      parsed = JSON.parse(body.toString('utf8'))
      body = Buffer.from(`${JSON.stringify(scrub(parsed), null, 2)}\n`)
    } catch {
      parsed = null // JSON Lines or not JSON after all: keep the bytes as served
    }
  }
  const file = fixtureFileName(key, contentType)
  fs.writeFileSync(path.join(dir, file), body)
  manifest.entries[`GET ${key}`] = { file, status: response.status, contentType }
  console.log(`${String(response.status).padEnd(4)} ${key}`)
  return { status: response.status, parsed, text: body.toString('utf8') }
}

await capture('/api/status')
await capture('/api/models')
await capture('/api/plugins')
await capture('/api/capsules/panes/pane-a')
await capture('/api/capsules/panes/pane-b')

// Pane C: the unparameterised list the tab loads, then each page it can
// follow, then every row's drilldown.
const exchangeKeys = new Set()
let page = await capture('/api/capsules/panes/pane-c')
for (;;) {
  for (const row of page.parsed?.rows ?? []) if (row.exchange_key) exchangeKeys.add(row.exchange_key)
  const after = page.parsed?.next_after_seq
  if (after == null) break
  page = await capture(`/api/capsules/panes/pane-c?after_seq=${after}`)
}
for (const exchangeKey of exchangeKeys) {
  await capture(`/api/capsules/panes/pane-c?exchange_id=${encodeURIComponent(exchangeKey)}`)
}

const ledger = await capture('/api/capsules/ledger/capsules.jsonl')
await capture('/api/capsules/ledger/node-key.pub.pem')
const capsuleIds = new Set()
for (const line of ledger.status === 200 ? ledger.text.split('\n') : []) {
  if (!line.trim()) continue
  try {
    const id = JSON.parse(line).capsule_id
    if (id) capsuleIds.add(id)
  } catch {
    // malformed line: the tab skips it too
  }
}
for (const id of capsuleIds) {
  await capture(`/api/capsules/ledger/signed-statements/${encodeURIComponent(id)}.cose`)
  await capture(`/api/capsules/ledger/disclosures/${encodeURIComponent(id)}.json`)
}

for (const extra of extraPaths) await capture(extra)

manifest.captured_from = 'scripts/capture-evidence-fixtures.mjs'
manifest.captured_at = new Date().toISOString()
fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`\n${Object.keys(manifest.entries).length} entries -> ${path.relative(process.cwd(), dir)}`)
