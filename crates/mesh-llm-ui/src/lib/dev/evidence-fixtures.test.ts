import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fixtureDir, fixtureFileName, fixtureKey, replay, scrubJsonText } from '@/lib/dev/evidence-fixtures-plugin'

describe('evidence fixture mode (dev server only)', () => {
  it('keys a request by path and verbatim query, so drilldowns stay distinct', () => {
    expect(fixtureKey('/api/capsules/panes/pane-c')).toBe('/api/capsules/panes/pane-c')
    expect(fixtureKey('/api/capsules/panes/pane-c?exchange_id=a')).not.toBe(
      fixtureKey('/api/capsules/panes/pane-c?exchange_id=b')
    )
    const a = fixtureFileName('/api/capsules/panes/pane-c?exchange_id=a', 'application/json')
    const b = fixtureFileName('/api/capsules/panes/pane-c?exchange_id=b', 'application/json')
    expect(a).not.toBe(b)
    expect(a.endsWith('.json')).toBe(true)
    expect(fixtureFileName('/api/capsules/ledger/signed-statements/x.cose', 'application/cose')).toMatch(/\.bin$/)
  })

  it('scrubs credentials and the host name at any depth, and nothing else', () => {
    const scrubbed = JSON.parse(
      scrubJsonText(
        JSON.stringify({
          token: 'invite-secret',
          my_hostname: 'box.local',
          node_id: 'n1',
          peers: [{ token: 't2', id: 'p' }]
        })
      )
    )
    expect(scrubbed.token).toBe('<scrubbed-in-fixture>')
    expect(scrubbed.my_hostname).toBe('<scrubbed-in-fixture>')
    expect(scrubbed.peers[0].token).toBe('<scrubbed-in-fixture>')
    expect(scrubbed.node_id).toBe('n1')
    expect(scrubbed.peers[0].id).toBe('p')
  })

  it('leaves JSON Lines bytes untouched (sealed records are recomputed in the browser)', () => {
    const jsonl = '{"capsule_id":"a","hostname":"h"}\n{"capsule_id":"b"}\n'
    expect(scrubJsonText(jsonl)).toBe(jsonl)
  })

  it('resolves a bare set name under the repo and a path as a path', () => {
    expect(fixtureDir('/repo/ui', 'run-1')).toBe('/repo/ui/src/features/capsules/__fixtures__/run-1')
    expect(fixtureDir('/repo/ui', '/shared/fixtures/run-1')).toBe('/shared/fixtures/run-1')
  })

  it('serves a captured response and answers a miss with 404, never invented data', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-fixtures-'))
    fs.writeFileSync(path.join(dir, 'b.json'), '{"rows":[]}')
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify({
        entries: { 'GET /api/capsules/panes/pane-b': { file: 'b.json', status: 200, contentType: 'application/json' } }
      })
    )
    const handle = replay(dir, 'run-1')
    const call = (url: string) => {
      const res = { statusCode: 0, headers: {} as Record<string, string>, body: '' }
      const response = {
        set statusCode(v: number) {
          res.statusCode = v
        },
        setHeader: (k: string, v: string) => {
          res.headers[k] = v
        },
        end: (b: Buffer | string) => {
          res.body = b.toString()
        }
      } as unknown as ServerResponse
      let passed = false
      handle({ url, method: 'GET' } as IncomingMessage, response, () => {
        passed = true
      })
      return { ...res, passed }
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(call('/api/capsules/panes/pane-b')).toMatchObject({ statusCode: 200, body: '{"rows":[]}' })
    const miss = call('/api/capsules/panes/pane-c')
    expect(miss.statusCode).toBe(404)
    expect(JSON.parse(miss.body).request).toBe('GET /api/capsules/panes/pane-c')
    expect(call('/src/main.tsx').passed).toBe(true)
    warn.mockRestore()
  })
})
