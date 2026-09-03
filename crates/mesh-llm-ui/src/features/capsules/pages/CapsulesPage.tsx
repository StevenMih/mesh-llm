import { useQuery } from '@tanstack/react-query'
import { fetchCapsuleLedger } from '@/features/capsules/api/client'
import { CapsuleCard } from '@/features/capsules/components/CapsuleCard'

export function CapsulesPageContent() {
  const ledgerQuery = useQuery({
    queryKey: ['capsules', 'ledger'],
    queryFn: fetchCapsuleLedger,
    refetchInterval: 15_000
  })

  return (
    <section className="mx-auto max-w-3xl">
      <div className="mb-4">
        <div className="type-label text-fg-faint">Accountability</div>
        <h1 className="type-display mt-1 text-foreground">Capsules</h1>
        <p className="type-body mt-2 max-w-[68ch] text-fg-dim">
          Reads this node&apos;s own capsule ledger — the exchanges the admission-policy plugin sealed on this
          machine&apos;s serving path. Each card&apos;s <span className="font-mono">capsule_id</span> and provider
          signature are recomputed and verified in your browser, not asserted by this page.
        </p>
      </div>

      {ledgerQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading capsule ledger…</p> : null}

      {ledgerQuery.isError ? (
        <p className="text-sm text-amber-500">
          Could not load the capsule ledger (
          {ledgerQuery.error instanceof Error ? ledgerQuery.error.message : 'unknown error'}
          ). Is a capsule-producing plugin installed and pointed at a ledger directory?
        </p>
      ) : null}

      {ledgerQuery.data && ledgerQuery.data.records.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No capsules in the ledger yet. Send a request through this node once the admission-policy plugin is running.
        </p>
      ) : null}

      {ledgerQuery.data?.records
        .slice()
        .reverse()
        .map((record, idx) => (
          <CapsuleCard key={record.capsule_id ?? idx} record={record} nodePubKeyPem={ledgerQuery.data.nodePubKeyPem} />
        ))}
    </section>
  )
}
