// Ask the other side of an exchange for its record: the host's
// `POST /api/evidence-requests` (loopback-only) sends one evidence request to
// that node over the mesh and hands back its reply unchanged -- an artifact
// carrying the record, or the refusal it signed. This client carries bytes;
// `ask-for-record.ts` judges them.
import { env } from '@/lib/env'

const ASK_URL = `${env.managementApiUrl}/api/evidence-requests`

export type EvidenceAskReply = { kind: 'answer'; answer: unknown } | { kind: 'no_answer'; message: string }

/** The evidence request that names one exchange by the client nonce both
 *  records of it carry. */
export function askByNonceRequest(nonce: string): Record<string, unknown> {
  return { subject: { kind: 'correlation', by: 'nonce', value: nonce }, coverage: {} }
}

export async function askForRecord(peerId: string, nonce: string): Promise<EvidenceAskReply> {
  let response: Response
  try {
    response = await fetch(ASK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ peer: peerId, request: askByNonceRequest(nonce) })
    })
  } catch (error) {
    return { kind: 'no_answer', message: error instanceof Error ? error.message : 'network error' }
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    return { kind: 'no_answer', message: text || `HTTP ${response.status}` }
  }
  const body = (await response.json().catch(() => null)) as { answer?: unknown } | null
  if (!body || !('answer' in body)) return { kind: 'no_answer', message: 'the reply carried no answer' }
  return { kind: 'answer', answer: body.answer }
}
