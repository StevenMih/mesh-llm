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
  // -> "Get the other side’s record" (7bc96e8a4)
  'Ask a peer',
  // -> "not held" (7bc96e8a4: the banned word "pending" left the on-screen state)
  'pending fetch',
  // retired by design: a calm verdict over records no one else confirmed
  'Nothing needs your attention',
  // the duplicate headline; the ruled vocabulary is "confirmed by the other side"
  'confirmed by anyone else',
  // -> "Their record hasn’t arrived yet."
  'Their capsule id: not given',
  // [mesh-evidence-tooltips-complete] UX §8 -- rule 4: a banned word stays off
  // the screen even to deny it; rule 3: plain words; rule 5: never ask for
  // what isn't needed.
  'not a reputation signal',
  'reputation',
  'judgement of the peer',
  'Nothing is a score',
  'a score',
  'xpand checks to fetch it', // both "Expand…" and "expand…"
  'Corroboration cannot come from you',
  'Their halves appear here',
  'cites your half by digest',
  'Ask them for their half',
  'Get the other side’s half',
  'covered by checkpoint (',
  // [mesh-evidence-plain-language-pass] + look findings (2026-09-26): one
  // term per thing, plain words, no designer notation on the face.
  'Closed by the other side', // -> "Confirmed by the other side"
  'recomputed in browser', // -> "recomputed here"
  'none sealed', // Disputes judged -> "none"
  '{ yours ', // bracket strip -> "Yours ● sealed —— Theirs ● same"
  '✓ same request and answer as yours', // -> "✓ They recorded the same request and answer"
  'bound (self-asserted)', // -> "linked (self-asserted)" + what it established
  'serve-boundary path', // -> "the plugin at this node’s serving boundary"
  'Registration is a separate step', // said once, in step 1
  // [mesh-evidence-look-findings-2026-09-26-p2]
  'no key bound', // records ARE signed by the node key -> "not linked to an owner"
  'open in Logs' // an inert control; returns only when it can link
] as const

const HERE = dirname(fileURLToPath(import.meta.url))
const EVIDENCE_UI_ROOT = HERE
const NATIVE_PANE = resolve(HERE, '../../../../mesh-llm-host-runtime/src/api/routes/capsule_panes_native.rs')
const SETTLEMENT_PANE = resolve(HERE, '../../../../mesh-llm-host-runtime/src/api/routes/capsule_panes_settlement.rs')

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
    const settlement = withoutComments(rustShippedPart(readFileSync(SETTLEMENT_PANE, 'utf8')))
    expect(settlement).toContain('fn payer_book')
    expect(offenders([{ label: 'capsule_panes_settlement.rs', code: settlement }])).toEqual([])
  })
})
