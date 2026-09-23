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
import type { PeerRecomputeState, RecomputedIdentity } from '@/features/capsules/lib/recompute-identity'
import { toneForState } from '@/features/capsules/lib/assurance-tone'
import { WHAT_ACTUALLY_HAPPENED_GROUP, WHAT_NODE_SAID_GROUP } from '@/features/capsules/lib/nine-properties'
import {
  buildChecksRows,
  buildCommitsToRows,
  buildHeaderRows,
  buildIdentityRow,
  theirsFetchable,
  type ChecksSideCell
} from '@/features/capsules/lib/security-checks-view'
import { ChipExplanationPopover } from '@/features/capsules/components/ChipExplanationPopover'
import { EVIDENCE_FILE_SENTENCE, exchangeEvidenceBundle, saveTextFile } from '@/features/capsules/lib/exchange-export'

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

function ChecksCell({
  cell,
  propertyKey,
  factKey
}: {
  cell: ChecksSideCell
  propertyKey: string
  factKey?: 'binding' | 'authority'
}) {
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
      {/* v3 §4: every chip opens the four-part explanation. */}
      <ChipExplanationPopover cell={cell} factKey={factKey} propertyKey={propertyKey}>
        <StatusBadge size="caption" tone={badgeToneFor(cell.state)}>
          {cell.label}
        </StatusBadge>
      </ChipExplanationPopover>
      {/* L-L: the input/policy phrase always renders inline, never on hover -- a bare state word is forbidden. */}
      <span>{cell.detail}</span>
    </p>
  )
}

export type SecurityChecksViewProps = {
  row: ExchangeLedgerRow
  identity: RecomputedIdentity
  localRecord: CapsuleRecord | null
  /** Lifted to `ExchangeStreamRow` (mounted for every visible row, not just
   *  an expanded one) so a fetch this panel triggers can also flip that
   *  row's always-visible status badge once it resolves -- see
   *  `exchange-row-state.ts`'s `deriveRightCellState`. Optional only so a
   *  caller that hasn't wired a live fetch degrades to "not fetched" (never
   *  a fabricated match) -- `ExchangeStreamRow` always supplies a real one. */
  theirsRecompute?: PeerRecomputeState
}

const NOT_FETCHED_DEFAULT: PeerRecomputeState = {
  status: 'not_fetched',
  idMatch: null,
  signatureOk: null,
  peerRecord: null,
  fetch: () => {}
}

export function SecurityChecksView({
  row,
  identity,
  localRecord,
  theirsRecompute = NOT_FETCHED_DEFAULT
}: SecurityChecksViewProps) {
  const [rawMode, setRawMode] = useState(false)
  const canFetchTheirs = theirsFetchable(row.raw) !== null

  const identityRow = buildIdentityRow(row.raw, identity, theirsRecompute)
  const headerRows = buildHeaderRows(row.raw, localRecord, theirsRecompute)
  const commitsToRows = buildCommitsToRows(row.raw, localRecord, theirsRecompute)
  const checksRows = buildChecksRows(row.raw, identity, theirsRecompute)
  const captureCoverageRow = checksRows.find((r) => r.key === 'capture_coverage')
  const nodeSaidRows = checksRows.filter((r) => r.key !== 'capture_coverage' && r.group === WHAT_NODE_SAID_GROUP)
  const actuallyHappenedRows = checksRows.filter((r) => r.group === WHAT_ACTUALLY_HAPPENED_GROUP)

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
      <div className="flex items-center justify-end gap-2">
        {/* The row's own `▾ checks` toggle (`ExchangeStreamRow`) is this
           panel's only header label -- not repeated here, so there is one
           source of the "is this expanded" fact, not two. */}
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
            {/* `[mesh-e9e10-pieces-3-4]` piece 4: a real peer-asserted join
               key exists but this browser has not fetched it yet -- an
               explicit action, never an automatic background fetch (a mesh
               call is not a free local read). Witness-level recompute only:
               the button never claims a verdict, just that this browser will
               go look. */}
            {canFetchTheirs && theirsRecompute.status !== 'fetching' ? (
              <Button
                className="ui-control h-6 w-fit gap-1 px-2 text-[length:var(--density-type-caption)]"
                data-peer-fetch-action="mesh_ledger_fetch"
                onClick={() => theirsRecompute.fetch()}
                size="sm"
                type="button"
                variant="outline"
              >
                fetch peer capsule &amp; recompute here
              </Button>
            ) : null}
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
              <div className="flex flex-col gap-0.5" key={commitsRow.label}>
                <p className="type-caption text-fg-faint">{commitsRow.label}</p>
                <TwoCol
                  theirs={
                    commitsRow.theirs ? (
                      <p className="truncate font-mono text-xs text-foreground">
                        {commitsRow.theirs.value}
                        <span className="ml-1 text-fg-faint">{commitsRow.theirs.note}</span>
                      </p>
                    ) : null
                  }
                  yours={<p className="truncate font-mono text-xs text-foreground">{commitsRow.yours}</p>}
                />
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <BlockHeading>checks</BlockHeading>

            {/* Two labelled groups, no counts (v3 §4 / tab-design v2.1) -- this
                node's own nine claims, then the one axis that isn't this
                node's claim at all. Never merged back into one flat list. */}
            <p
              className="type-caption font-mono uppercase tracking-wide text-fg-faint"
              data-check-group={WHAT_NODE_SAID_GROUP}
            >
              {WHAT_NODE_SAID_GROUP}
            </p>
            {nodeSaidRows.map((checkRow) => (
              <div className="flex flex-col gap-0.5" key={checkRow.key}>
                <p className="type-caption text-fg-faint">{checkRow.label}</p>
                {checkRow.facts ? (
                  <div className="flex flex-col gap-0.5">
                    {checkRow.facts.map((fact) => (
                      <div className="flex items-baseline gap-1.5" key={fact.factLabel}>
                        <span className="type-caption text-fg-faint">{fact.factLabel}</span>
                        <ChecksCell
                          cell={fact.cell}
                          factKey={fact.factLabel as 'binding' | 'authority'}
                          propertyKey={checkRow.key}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <TwoCol
                    theirs={checkRow.theirs ? <ChecksCell cell={checkRow.theirs} propertyKey={checkRow.key} /> : null}
                    yours={checkRow.yours ? <ChecksCell cell={checkRow.yours} propertyKey={checkRow.key} /> : null}
                  />
                )}
              </div>
            ))}
            {captureCoverageRow ? (
              <p className="text-xs text-fg-dim">
                <span className="text-fg-faint">{captureCoverageRow.label}</span> {captureCoverageRow.singleLine}
              </p>
            ) : null}

            <p
              className="type-caption font-mono uppercase tracking-wide text-fg-faint"
              data-check-group={WHAT_ACTUALLY_HAPPENED_GROUP}
            >
              {WHAT_ACTUALLY_HAPPENED_GROUP}
            </p>
            {actuallyHappenedRows.map((checkRow) => (
              <div className="flex flex-col gap-0.5" key={checkRow.key}>
                <p className="type-caption text-fg-faint">{checkRow.label}</p>
                <TwoCol
                  theirs={checkRow.theirs ? <ChecksCell cell={checkRow.theirs} propertyKey={checkRow.key} /> : null}
                  yours={checkRow.yours ? <ChecksCell cell={checkRow.yours} propertyKey={checkRow.key} /> : null}
                />
              </div>
            ))}
          </div>
        </>
      )}

      {/* [ledger-T4-inline-inspector] "Save evidence file" acts on the
         current scope (v3 §4) -- from a row it saves that exchange. `open in
         Logs` is a shell only: the Ledger and Logs sides of one call don't
         yet share a single id to link through -- [ledger-T5-join-key]
         supplies the target. */}
      <div className="flex flex-col gap-1.5 border-t border-border-soft pt-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            className="ui-control h-7 gap-1 rounded-[var(--radius)] px-2 text-[length:var(--density-type-caption)]"
            onClick={() =>
              saveTextFile(
                `mesh-exchange-${row.exchangeKey}-evidence.json`,
                exchangeEvidenceBundle([row.raw]),
                'application/json'
              )
            }
            size="sm"
            type="button"
            variant="outline"
          >
            Save evidence file
          </Button>
          <Button
            className="ui-control h-7 gap-1 rounded-[var(--radius)] px-2 text-[length:var(--density-type-caption)]"
            disabled
            size="sm"
            title="Needs one id shared with Logs before this can link there — see ledger-T5-join-key"
            type="button"
            variant="outline"
          >
            open in Logs
          </Button>
        </div>
        <p className="text-xs text-fg-faint">{EVIDENCE_FILE_SENTENCE}</p>
      </div>
    </div>
  )
}
