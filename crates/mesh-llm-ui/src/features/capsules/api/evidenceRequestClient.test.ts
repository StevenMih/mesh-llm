import { afterEach, describe, expect, it, vi } from 'vitest'
import { askByNonceRequest, askForRecord, evidenceRequestBytes } from '@/features/capsules/api/evidenceRequestClient'
import { sha256Hex } from '@/features/capsules/lib/canonical'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('askForRecord', () => {
  it('names the digest of the exact request bytes it sent, and the announced key', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ answer: { reason: 'no_such_record' }, announced_key_id: 'AB'.repeat(32) }), {
          status: 200
        })
    )
    vi.stubGlobal('fetch', fetchMock)

    const reply = await askForRecord('c'.repeat(64), 'nonce-1')

    const sent = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)) as {
      request: Record<string, unknown>
    }
    // The peer digests these bytes (compact, keys sorted, as serde_json
    // re-serializes them either way); a refusal must name this digest.
    expect(JSON.stringify(sent.request)).toBe(
      '{"coverage":{},"subject":{"by":"nonce","kind":"correlation","value":"nonce-1"}}'
    )
    expect(reply).toEqual({
      kind: 'answer',
      answer: { reason: 'no_such_record' },
      announcedKeyId: 'ab'.repeat(32),
      sentRequestDigest: await sha256Hex(evidenceRequestBytes(askByNonceRequest('nonce-1')))
    })
  })

  it('carries no announced key when the host has none for that peer', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ answer: {}, announced_key_id: null })))
    const reply = await askForRecord('c'.repeat(64), 'nonce-1')
    expect(reply).toMatchObject({ kind: 'answer', announcedKeyId: null })
  })
})
