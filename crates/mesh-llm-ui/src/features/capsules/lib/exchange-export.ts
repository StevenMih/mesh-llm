// Two distinct exports for the Exchanges table ([mesh-ledger-phase3-tables-
// and-modal] Part 3) — "Export view" (a CSV of the current table, exactly
// what's on screen) and "Save evidence file" (the portable evidence bundle:
// full Pane C records, including the nine-property detail the table's
// Checks column only names, never a spreadsheet-shaped summary of the same
// facts). Never collapsed into one action -- the two have different
// semantics and different consumers.
import type { PaneCRow } from '@/features/capsules/api/sidecarTypes'
import type { ExchangeLedgerRow } from '@/features/capsules/lib/exchange-ledger'

const CSV_COLUMNS = ['Time', 'Exchange ID', 'Counterparty', 'Your role', 'Confirmed', 'Checks'] as const

function csvCell(value: string): string {
  if (!/[",\n]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

export function exchangeRowsToCsv(rows: readonly ExchangeLedgerRow[]): string {
  const lines = [CSV_COLUMNS.join(',')]
  for (const row of rows) {
    lines.push(
      [
        row.timestamp ?? '',
        row.exchangeKey,
        row.counterparty ?? '',
        row.roleTag,
        row.confirmed ? 'confirmed' : 'not yet confirmed',
        row.checksText
      ]
        .map(csvCell)
        .join(',')
    )
  }
  return `${lines.join('\n')}\n`
}

/** The evidence bundle -- the underlying Pane C records themselves (full
 *  nine-property detail included), not a re-shaping of the table. */
export function exchangeEvidenceBundle(rows: readonly PaneCRow[]): string {
  return `${JSON.stringify({ schema: 'mesh-ledger-exchanges-evidence/1', exchanges: rows }, null, 2)}\n`
}

export function saveTextFile(fileName: string, content: string, mediaType: string): boolean {
  if (
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function' ||
    typeof URL.revokeObjectURL !== 'function'
  ) {
    return false
  }
  const url = URL.createObjectURL(new Blob([content], { type: mediaType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  anchor.hidden = true
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  return true
}
