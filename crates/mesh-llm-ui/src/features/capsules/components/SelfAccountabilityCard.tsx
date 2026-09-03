// Pane A ("This node") of the Accountability tab
// ([mesh-pane-a-self-accountability-tab]). Renders capsule-emit-mesh's
// `self_accountability.py`-computed card verbatim -- this component labels
// and colors what the card already says, it never re-derives a fact.
//
// Colour discipline (green=silence / grey=distinct labeled state / red=a
// specific failed check, never yellow): a row is GREEN only when it has an
// affirmative, checked-good state (fully sealed, unbroken+witnessed history,
// a verified rung). A row is GREY when the fact is honestly absent, pending,
// or not-yet-available -- never blended with green. A row is RED only for a
// specific named failure (unsealed requests, a broken/forked history,
// contradicted adjudications) -- never a vague warning.
import { cn } from '@/lib/utils'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { SelfAccountabilityCard as SelfAccountabilityCardData } from '@/features/capsules/api/types'
import {
  adjudicationsTone,
  historyTone,
  sealingTone,
  type Tone
} from '@/features/capsules/lib/self-accountability-tone'

const TONE_CLASS: Record<Tone, string> = {
  green: 'text-emerald-500',
  grey: 'text-muted-foreground',
  red: 'text-red-500'
}

function Dot({ tone }: { tone: Tone }) {
  return (
    <span className={cn('mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-current align-middle', TONE_CLASS[tone])} />
  )
}

function Row({ tone, label, detail }: { tone: Tone; label: string; detail?: string | null }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className={cn('font-medium', TONE_CLASS[tone])}>
        <Dot tone={tone} />
        {label}
      </span>
      {detail ? <span className="text-right text-fg-dim">{detail}</span> : null}
    </div>
  )
}

export function SelfAccountabilityCard({ card }: { card: SelfAccountabilityCardData }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>This node</CardTitle>
        <p className="type-body mt-1 max-w-[68ch] text-fg-dim">
          What this node can show about itself, computed entirely from its own ledger and receipts.
        </p>
      </CardHeader>
      <CardContent className="divide-y divide-border/60">
        <section className="py-2">
          <div className="type-label text-fg-faint">Sealing</div>
          <Row tone={sealingTone(card.sealing)} label={card.sealing.coverage_summary} />
          {card.sealing.last_sealed ? <Row tone="grey" label={`last sealed ${card.sealing.last_sealed}`} /> : null}
          {card.sealing.failed_sealed ? (
            <Row tone="red" label="a FAILED request has no BLOCKED/errored capsule" />
          ) : null}
          {card.sealing.unsealed_rows.slice(0, 5).map((row, i) => (
            <Row key={i} tone="red" label={String(row.request_id ?? 'request')} detail={row.finding as string} />
          ))}
        </section>

        <section className="py-2">
          <div className="type-label text-fg-faint">History</div>
          <Row
            tone={historyTone(card.history)}
            label={
              card.history.checkpoint_count === 0
                ? 'no checkpoints yet'
                : `${card.history.continuity} · ${card.history.checkpoint_count} checkpoint(s)`
            }
            detail={card.history.continuous_since ? `since ${card.history.continuous_since}` : undefined}
          />
          <Row
            tone={card.history.witnessed ? 'green' : 'grey'}
            label={card.history.witnessed ? 'witnessed' : 'not yet witnessed'}
          />
        </section>

        <section className="py-2">
          <div className="type-label text-fg-faint">Rung</div>
          <Row
            tone={card.rung.freshness.state === 'absent' ? 'grey' : 'green'}
            label={`freshness: ${card.rung.freshness.state}`}
          />
          <Row tone="grey" label={`cross-party: ${card.rung.cross_party.rung}`} />
          <Row
            tone={card.rung.runtime_binding.state === 'absent' ? 'grey' : 'green'}
            label={`runtime/binding: ${card.rung.runtime_binding.state}`}
          />
          <Row tone="grey" label="weights_digest: absent" detail={card.rung.weights_digest.reason} />
          <Row
            tone={
              card.rung.identity.owner_status === 'bound'
                ? 'green'
                : card.rung.identity.owner_status === 'invalid'
                  ? 'red'
                  : 'grey'
            }
            label={`identity: owner ${card.rung.identity.owner_status ?? 'absent'}`}
          />
        </section>

        <section className="py-2">
          <div className="type-label text-fg-faint">Shared</div>
          <Row
            tone="grey"
            label="cards / bundles served, refusals issued: not yet available"
            detail={card.shared.refusals_issued.reason}
          />
        </section>

        <section className="py-2">
          <div className="type-label text-fg-faint">Adjudications involving me</div>
          <Row
            tone={adjudicationsTone(card.adjudications)}
            label={`corroborated ${card.adjudications.corroborated} · contradicted ${card.adjudications.contradicted} · inconclusive ${card.adjudications.inconclusive}`}
          />
        </section>

        <p className="pt-3 text-xs text-fg-faint">{card.honesty_line}</p>
      </CardContent>
    </Card>
  )
}
