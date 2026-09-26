// Copy pin ([mesh-closed-restack-not-merge]): wording the Evidence surface
// retired must never come back. Two stale-base branches merged into the freeze
// line once and quietly re-imported it ("Ask a peer" went 0 -> 5), so this
// scans the SOURCE of every shipped Evidence file -- UI and the Rust pane that
// feeds it -- rather than trusting that each component test happens to render
// the right state. Comments are stripped first: history notes may quote a
// retired phrase; code and copy may not.
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const RETIRED_PHRASES = [
  // -> "Get the other side’s half" (7bc96e8a4)
  'Ask a peer',
  // -> "not held" (7bc96e8a4: the banned word "pending" left the on-screen state)
  'pending fetch',
  // retired by design: a calm verdict over records no one else confirmed
  'Nothing needs your attention',
  // the duplicate headline; the ruled vocabulary is "confirmed by the other side"
  'confirmed by anyone else',
  // -> "No fetchable capsule id from them — their half is not held."
  'Their capsule id: not given'
] as const

const HERE = dirname(fileURLToPath(import.meta.url))
const EVIDENCE_UI_ROOT = HERE
const NATIVE_PANE = resolve(HERE, '../../../../mesh-llm-host-runtime/src/api/routes/capsule_panes_native.rs')

function shippedSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return shippedSources(path)
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [path] : []
  })
}

/** Drop block and line comments; keep `://` inside strings (URLs). */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** The Rust pane's test module holds fixtures, not shipped copy. */
function rustShippedPart(source: string): string {
  const tests = source.indexOf('#[cfg(test)]')
  return tests === -1 ? source : source.slice(0, tests)
}

function offenders(files: Array<{ label: string; code: string }>): string[] {
  return files.flatMap(({ label, code }) =>
    RETIRED_PHRASES.filter((phrase) => code.includes(phrase)).map((phrase) => `${label}: "${phrase}"`)
  )
}

describe('retired Evidence copy stays retired', () => {
  it('scans a real, non-empty set of shipped Evidence sources', () => {
    expect(shippedSources(EVIDENCE_UI_ROOT).length).toBeGreaterThan(20)
    expect(readFileSync(NATIVE_PANE, 'utf8')).toContain('fn build_pane_c_list')
  })

  it('no shipped Evidence UI source carries a retired phrase', () => {
    const files = shippedSources(EVIDENCE_UI_ROOT).map((path) => ({
      label: relative(EVIDENCE_UI_ROOT, path),
      code: withoutComments(readFileSync(path, 'utf8'))
    }))
    expect(offenders(files)).toEqual([])
  })

  it('the Rust pane that feeds the tab carries no retired phrase', () => {
    const code = withoutComments(rustShippedPart(readFileSync(NATIVE_PANE, 'utf8')))
    expect(offenders([{ label: 'capsule_panes_native.rs', code }])).toEqual([])
  })
})
