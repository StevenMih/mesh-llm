// Fetches the capsule ledger from the mesh-llm host's read-only ledger route
// (crates/mesh-llm-host-runtime/src/api/routes/capsules.rs). This tab has its
// OWN data source -- the capsule ledger the admission-policy plugin writes to
// disk -- and never joins into mesh-llm's own log store.
import { env } from '@/lib/env'
import type {
  CapsuleLedger,
  CapsuleRecord,
  DisclosurePreimage,
  SelfAccountabilityCard
} from '@/features/capsules/api/types'

const LEDGER_BASE = `${env.managementApiUrl}/api/capsules/ledger`

function parseJsonl(text: string): CapsuleRecord[] {
  const records: CapsuleRecord[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      records.push(JSON.parse(trimmed) as CapsuleRecord)
    } catch {
      // Skip a malformed line rather than failing the whole ledger view.
    }
  }
  return records
}

export async function fetchCapsuleLedger(): Promise<CapsuleLedger> {
  const ledgerResponse = await fetch(`${LEDGER_BASE}/capsules.jsonl`)
  if (!ledgerResponse.ok) {
    if (ledgerResponse.status === 404) return { records: [], nodePubKeyPem: null }
    throw new Error(`capsule ledger fetch failed: HTTP ${ledgerResponse.status}`)
  }
  const records = parseJsonl(await ledgerResponse.text())

  let nodePubKeyPem: string | null = null
  try {
    const keyResponse = await fetch(`${LEDGER_BASE}/node-key.pub.pem`)
    if (keyResponse.ok) nodePubKeyPem = await keyResponse.text()
  } catch {
    nodePubKeyPem = null
  }

  return { records, nodePubKeyPem }
}

/** Fetches capsule_id's detached COSE_Sign1 signed statement, or null if none exists. */
export async function fetchSignedStatement(capsuleId: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(`${LEDGER_BASE}/signed-statements/${encodeURIComponent(capsuleId)}.cose`)
    if (!response.ok) return null
    return new Uint8Array(await response.arrayBuffer())
  } catch {
    return null
  }
}

/**
 * Fetches capsule_id's OPTIONAL local disclosure preimage (the request+
 * response TEXT a capsule-emit-mesh sidecar wrote next to the ledger --
 * capsule-emit-mesh PR #79), or null when none exists. Most capsules have
 * none: the signed capsule commits to request/response by digest only, and
 * this file is a separate, out-of-band attachment.
 */
export async function fetchDisclosurePreimage(capsuleId: string): Promise<DisclosurePreimage | null> {
  try {
    const response = await fetch(`${LEDGER_BASE}/disclosures/${encodeURIComponent(capsuleId)}.json`)
    if (!response.ok) return null
    return (await response.json()) as DisclosurePreimage
  } catch {
    return null
  }
}

/**
 * Fetches Pane A ("This node")'s self-accountability card
 * ([mesh-pane-a-self-accountability-tab]) -- written by capsule-emit-mesh's
 * `self_accountability.py build` CLI to `<ledger_dir>/accountability_self.json`.
 * `null` when the sidecar hasn't produced one yet (not every node has run the
 * CLI) -- distinct from an HTTP error, which the caller should surface, not
 * silently fold into "no card".
 */
export async function fetchSelfAccountabilityCard(): Promise<SelfAccountabilityCard | null> {
  const response = await fetch(`${LEDGER_BASE}/accountability_self.json`)
  if (!response.ok) {
    if (response.status === 404) return null
    throw new Error(`self-accountability card fetch failed: HTTP ${response.status}`)
  }
  return (await response.json()) as SelfAccountabilityCard
}
