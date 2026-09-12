// Toggle ② the security view ([mesh-ledger-b5-security-view], v3 §4) --
// renders INLINE under the row, keeping the two-sided columns, never a
// modal (v3 §4 "Where"). Exact block order: IDENTITY -> HEADER -> WHAT IT
// COMMITS TO -> CHECKS -> raw (raw bytes last).
import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { StatusBadge, type StatusBadgeTone } from '@/components/ui/StatusBadge'
import { cn } from '@/lib/cn'
import type { CapsuleRecord } from '@/features/capsules/api/types'
import type { ExchangeLedgerRow } from '@/features/capsules/lib/exchange-ledger'
import type { RecomputedIdentity } from '@/features/capsules/lib/recompute-identity'
import { toneForState } from '@/features/capsules/lib/assurance-tone'
import {
  buildChecksRows,
  buildCommitsToRows,
  buildHeaderRows,
  buildIdentityRow,
  type ChecksSideCell
} from '@/features/capsules/lib/security-checks-view'

function badgeToneFor(state: string): StatusBadgeTone {
  const tone = toneForState(state)
  return tone === 'neutral' ? 'muted' : (tone as StatusBadgeTone)
}

function BlockHeading({ children }: { children: string }) {
  return (
    <p className="type-caption font-mono uppercase tracking-wide text-fg-faint" data-block-heading={children}>
      {children}
    </p>
  )
}

function TwoCol({ yours, theirs }: { yours: ReactNode; theirs: ReactNode | null }) {
  return (
    <div className="grid grid-cols-2 gap-x-3">
      <div className="min-w-0">{yours}</div>
      <div className="min-w-0">{theirs}</div>
    </div>
  )
}

function ChecksCell({ cell }: { cell: ChecksSideCell }) {
  // L-M: recomputed-here and taken-from-the-source must never render
  // identically -- distinct class + a distinct data attribute so a test can
  // assert the two classes differ, not just eyeball it.
  return (
    <p
      className={cn(
        'flex flex-wrap items-baseline gap-1.5 text-xs',
        cell.recomputed
          ? 'border-l-2 border-accent/60 pl-1.5 text-foreground'
          : 'border-l-2 border-transparent pl-1.5 text-fg-dim'
      )}
      data-recomputed={cell.recomputed ? 'true' : 'false'}
      data-source={cell.recomputed ? 'recomputed-in-browser' : 'from-sidecar'}
    >
      <StatusBadge size="caption" tone={badgeToneFor(cell.state)}>
        {cell.label}
      </StatusBadge>
      {/* L-L: the input/policy phrase always renders inline, never on hover -- a bare state word is forbidden. */}
      <span>{cell.detail}</span>
    </p>
  )
}

export type SecurityChecksViewProps = {
  row: ExchangeLedgerRow
  identity: RecomputedIdentity
  localRecord: CapsuleRecord | null
}

export function SecurityChecksView({ row, identity, localRecord }: SecurityChecksViewProps) {
  const [rawMode, setRawMode] = useState(false)

  const identityRow = buildIdentityRow(row.raw, identity)
  const headerRows = buildHeaderRows(row.raw, localRecord)
  const commitsToRows = buildCommitsToRows(row.raw, localRecord)
  const checksRows = buildChecksRows(row.raw, identity)
  const captureCoverageRow = checksRows.find((r) => r.key === 'capture_coverage')
  const propertyChecksRows = checksRows.filter((r) => r.key !== 'capture_coverage')

  async function copyBoth() {
    const payload = JSON.stringify({ mine: row.raw.mine, theirs: row.raw.theirs }, null, 2)
    try {
      await navigator.clipboard.writeText(payload)
    } catch {
      // clipboard access denied/unavailable -- no crash, nothing else to do here.
    }
  }

  return (
    <div
      aria-label={`Security checks for ${row.exchangeKey}`}
      className="flex flex-col gap-3 rounded border border-border-soft bg-panel px-3 py-3"
      data-security-view="expanded"
      onClick={(event) => event.stopPropagation()}
      role="region"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="type-caption font-mono text-fg-faint">▾ checks</p>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded border border-border-soft" role="group">
            <Button
              aria-pressed={!rawMode}
              className="ui-control h-6 rounded-none px-2 text-[length:var(--density-type-caption)]"
              onClick={() => setRawMode(false)}
              size="sm"
              type="button"
              variant={rawMode ? 'ghost' : 'outline'}
            >
              readable
            </Button>
            <Button
              aria-pressed={rawMode}
              className="ui-control h-6 rounded-none px-2 text-[length:var(--density-type-caption)]"
              onClick={() => setRawMode(true)}
              size="sm"
              type="button"
              variant={rawMode ? 'outline' : 'ghost'}
            >
              raw
            </Button>
          </div>
          <Button
            className="ui-control h-6 gap-1 px-2 text-[length:var(--density-type-caption)]"
            onClick={copyBoth}
            size="sm"
            type="button"
            variant="outline"
          >
            ⧉ copy both
          </Button>
        </div>
      </div>

      {rawMode ? (
        <pre className="max-h-64 overflow-auto rounded border border-border-soft bg-background p-2 font-mono text-xs text-fg-dim">
          {JSON.stringify({ mine: row.raw.mine, theirs: row.raw.theirs }, null, 2)}
        </pre>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <BlockHeading>identity</BlockHeading>
            <TwoCol
              theirs={
                identityRow.theirs ? (
                  <p className="font-mono text-xs text-foreground">
                    {identityRow.theirs.value}
                    <span className="block text-fg-faint">{identityRow.theirs.note}</span>
                  </p>
                ) : null
              }
              yours={
                <p className="font-mono text-xs text-foreground">
                  {identityRow.yours.value}
                  <span className="block text-fg-faint">{identityRow.yours.note}</span>
                </p>
              }
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <BlockHeading>header</BlockHeading>
            {headerRows.map((headerRow) => (
              <div className="flex flex-col gap-0.5" key={headerRow.label}>
                <p className="type-caption text-fg-faint">{headerRow.label}</p>
                <TwoCol
                  theirs={
                    headerRow.theirs ? (
                      <p className="text-xs text-foreground">
                        {headerRow.theirs.value}
                        {headerRow.theirs.note ? (
                          <span className="ml-1 text-fg-faint">{headerRow.theirs.note}</span>
                        ) : null}
                      </p>
                    ) : null
                  }
                  yours={<p className="text-xs text-foreground">{headerRow.yours.value}</p>}
                />
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <BlockHeading>what it commits to</BlockHeading>
            {commitsToRows.map((commitsRow) => (
              <div className="flex items-baseline justify-between gap-2 text-xs" key={commitsRow.label}>
                <span className="text-fg-faint">{commitsRow.label}</span>
                <span className="truncate font-mono text-foreground">{commitsRow.yours}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <BlockHeading>checks</BlockHeading>
            {propertyChecksRows.map((checkRow) => (
              <div className="flex flex-col gap-0.5" key={checkRow.key}>
                <p className="type-caption text-fg-faint">{checkRow.label}</p>
                <TwoCol
                  theirs={checkRow.theirs ? <ChecksCell cell={checkRow.theirs} /> : null}
                  yours={checkRow.yours ? <ChecksCell cell={checkRow.yours} /> : null}
                />
              </div>
            ))}
            {captureCoverageRow ? (
              <p className="text-xs text-fg-dim">
                <span className="text-fg-faint">{captureCoverageRow.label}</span> {captureCoverageRow.singleLine}
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
