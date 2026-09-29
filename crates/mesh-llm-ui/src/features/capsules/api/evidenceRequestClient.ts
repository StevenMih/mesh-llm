// Ask the other side of an exchange for its record: the host's
// `POST /api/evidence-requests` (loopback-only) sends one evidence request to
// that node over the mesh and hands back its reply unchanged -- an artifact
// carrying the record, or the refusal it signed. This client carries bytes;
// `ask-for-record.ts` judges them.
import { env } from '@/lib/env'
import { sha256Hex } from '@/features/capsules/lib/canonical'

const ASK_URL = `${env.managementApiUrl}/api/evidence-requests`

/** An answer comes with what it must be judged against: the key this node
 *  was told the peer signs with (`null` when none is announced), and the
 *  digest of the request bytes we sent, which a refusal must name. */
export type EvidenceAskReply =
  | { kind: 'answer'; answer: unknown; announcedKeyId: string | null; sentRequestDigest: string }
  | { kind: 'no_answer'; message: string }

/** The evidence request that names one exchange by the client nonce both
 *  records of it carry. Keys sorted at every level, so the bytes the peer
 *  digests are these whether the hops on the way keep key order or sort it
 *  (`serde_json` does one or the other, compact either way). */
export function askByNonceRequest(nonce: string): Record<string, unknown> {
  return { coverage: {}, subject: { by: 'nonce', kind: 'correlation', value: nonce } }
}

/** The bytes the peer receives for `request`: compact JSON. */
export function evidenceRequestBytes(request: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(request))
}

export async function askForRecord(peerId: string, nonce: string): Promise<EvidenceAskReply> {
  const request = askByNonceRequest(nonce)
  const sentRequestDigest = await sha256Hex(evidenceRequestBytes(request))
  let response: Response
  try {
    response = await fetch(ASK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ peer: peerId, request })
    })
  } catch (error) {
    return { kind: 'no_answer', message: error instanceof Error ? error.message : 'network error' }
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return { kind: 'no_answer', message: text || `HTTP ${response.status}` }
  }
  const body = (await response.json().catch(() => null)) as { answer?: unknown; announced_key_id?: unknown } | null
  if (!body || !('answer' in body)) return { kind: 'no_answer', message: 'the reply carried no answer' }
  const announcedKeyId = typeof body.announced_key_id === 'string' ? body.announced_key_id.toLowerCase() : null
  return { kind: 'answer', answer: body.answer, announcedKeyId, sentRequestDigest }
}
