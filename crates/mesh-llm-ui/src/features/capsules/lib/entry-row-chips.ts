// Row-level chip strip ([mesh-evidence-ui-entry-row-and-chips], design §3A):
// `content · sig · inclusion · registered · theirs`, a condensed three-mark
// summary of five named properties -- distinct from the `▸ checks` panel's
// own five-state detail (`assurance-tone.ts`'s CHIP_GLYPH/CHIP_TONE), which
// this strip links into rather than duplicates.
import type { PaneCRow } from '@/features/capsules/api/sidecarTypes'

export type EntryRowChipKey = 'content' | 'sig' | 'inclusion' | 'registered' | 'theirs'
export type EntryRowChipMark = '✓' | '✗' | '–'

export const ENTRY_ROW_CHIP_ORDER: readonly EntryRowChipKey[] = ['content', 'sig', 'inclusion', 'registered', 'theirs']

// The one property each chip names, verbatim design §3A -- never re-derive
// this mapping ad hoc at a call site.
const CHIP_PROPERTY_KEY: Record<EntryRowChipKey, string> = {
  content: 'content_binding',
  sig: 'producer_signature',
  inclusion: 'local_inclusion',
  registered: 'external_registration',
  theirs: 'outcome_corroboration'
}

/** The `security-checks-view.ts` `ChecksRow.key` (== the nine/ten-property
 *  map's key) this chip is a link into -- also the id fragment
 *  `checkRowDomId` (`exchange-pages.ts`) targets for the jump. */
export function entryRowChipPropertyKey(chip: EntryRowChipKey): string {
  return CHIP_PROPERTY_KEY[chip]
}

/** PASS -> green check, FAIL -> red cross, everything else (NOT_PRESENT /
 *  NOT_CHECKED / INCONCLUSIVE, or the property entirely absent from this
 *  row's `properties`) -> the neutral dash. Never a fabricated pass/fail for
 *  a property this row's payload doesn't carry an opinion on. */
export function entryRowChipMark(row: PaneCRow, chip: EntryRowChipKey): EntryRowChipMark {
  const cell = row.properties?.[CHIP_PROPERTY_KEY[chip]]
  if (cell?.state === 'PASS') return '✓'
  if (cell?.state === 'FAIL') return '✗'
  return '–'
}
