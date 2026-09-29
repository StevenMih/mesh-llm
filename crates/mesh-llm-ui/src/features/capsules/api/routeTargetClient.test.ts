import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearRouteTarget, fetchRouteTarget, setRouteTarget } from '@/features/capsules/api/routeTargetClient'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('routeTargetClient', () => {
  it('sets, reads and clears the host-side target', async () => {
    const node = 'a'.repeat(64)
    const fetchMock = vi.fn(
      async (_url: string, init?: RequestInit) =>
        new Response(JSON.stringify({ node_id: init?.method === 'DELETE' ? null : node }))
    )
    vi.stubGlobal('fetch', fetchMock)

    expect(await setRouteTarget(node)).toBe(node)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/api\/route-target$/)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ node_id: node })

    expect(await fetchRouteTarget()).toBe(node)
    expect(await clearRouteTarget()).toBeNull()
    expect((fetchMock.mock.calls[2] as [string, RequestInit])[1].method).toBe('DELETE')
  })

  it('throws when the host refuses, so the button can say so', async () => {
    vi.stubGlobal('fetch', async () => new Response('forbidden', { status: 403 }))
    await expect(setRouteTarget('a'.repeat(64))).rejects.toThrow('forbidden')
  })
})
