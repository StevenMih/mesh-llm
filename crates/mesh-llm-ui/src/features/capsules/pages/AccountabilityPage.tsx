// The Accountability tab scaffold ([mesh-pane-a-self-accountability-tab]):
// three panes over history -- mine (This node), theirs (Peers), this one
// (This exchange) -- replacing the single per-record "Capsules" list this
// route used to render directly. See mesh-accountability-ui design doc §2.
//
// This file OWNS the tab scaffold; it does not own Pane B or Pane C's own
// mechanics -- those are separately filed tasks
// ([mesh-pane-b-peers-accountability-tab], [mesh-pane-c-exchange-subtab])
// that extend the stub / existing content below in place.
import { useQuery } from '@tanstack/react-query'
import { TabPanel } from '@/components/ui/TabPanel'
import { fetchSelfAccountabilityCard } from '@/features/capsules/api/client'
import { SelfAccountabilityCard } from '@/features/capsules/components/SelfAccountabilityCard'
import { CapsulesPageContent } from '@/features/capsules/pages/CapsulesPage'

type AccountabilityPane = 'self' | 'peers' | 'exchange'

function ThisNodePane() {
  const cardQuery = useQuery({
    queryKey: ['capsules', 'accountability', 'self'],
    queryFn: fetchSelfAccountabilityCard,
    refetchInterval: 15_000
  })

  if (cardQuery.isLoading)
    return <p className="text-sm text-muted-foreground">Loading this node’s accountability card…</p>

  if (cardQuery.isError) {
    return (
      <p className="text-sm text-amber-500">
        Could not load this node’s accountability card (
        {cardQuery.error instanceof Error ? cardQuery.error.message : 'unknown error'}).
      </p>
    )
  }

  if (!cardQuery.data) {
    return (
      <p className="text-sm text-muted-foreground">
        No self-accountability card yet. Run <span className="font-mono">self_accountability.py build</span> against
        this node’s ledger to produce one.
      </p>
    )
  }

  return <SelfAccountabilityCard card={cardQuery.data} />
}

function PeersPane() {
  return (
    <p className="text-sm text-muted-foreground">
      Peers pane not built yet — [mesh-pane-b-peers-accountability-tab] fills this in: one row per node exchanged with,
      each cell recomputed from their own artifacts.
    </p>
  )
}

export function AccountabilityPageContent() {
  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-4">
        <div className="type-label text-fg-faint">Accountability</div>
        <h1 className="type-display mt-1 text-foreground">Accountability</h1>
        <p className="type-body mt-2 max-w-[68ch] text-fg-dim">
          Three views over history: what this node can show about itself, what the nodes you use have shown you, and the
          per-exchange record. Everything shown is a property recomputed from artifacts — never a score.
        </p>
      </div>

      <TabPanel<AccountabilityPane>
        ariaLabel="Accountability panes"
        defaultValue="self"
        stretchTabs={false}
        contentClassName="px-0 pt-4"
        tabs={[
          { value: 'self', label: 'This node', content: <ThisNodePane /> },
          { value: 'peers', label: 'Peers', content: <PeersPane /> },
          { value: 'exchange', label: 'This exchange', content: <CapsulesPageContent /> }
        ]}
      />
    </section>
  )
}
