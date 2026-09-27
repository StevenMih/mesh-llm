import { describe, expect, it } from 'vitest'
import type { PaneBRow } from '@/features/capsules/api/sidecarTypes'
import { HARNESS_PANE_B_PAYLOAD } from '@/features/capsules/lib/peer-fixtures'
import {
  dealingsLines,
  recordText,
  routableNodeId,
  routingState,
  routingStateText,
  type PeerBlocksJson,
  type PeerRoutingChoice
} from '@/features/capsules/lib/peer-routing-view'
import { ROUTING_BLOCK_COPY } from '@/features/capsules/lib/tooltip-copy'

const NODE = 'a70d3967bea3b22fa48a28f77c5d2b3764fc8bd5204a82c09ff8430f3f2a0a00'
const OTHER = 'b'.repeat(64)
const DAY = 24 * 60 * 60 * 1000
const AT = Date.UTC(2026, 8, 27)

function withIdentity(identity: PaneBRow['identity']): PaneBRow {
  return { ...HARNESS_PANE_B_PAYLOAD.rows[0], identity }
}

function choice(overrides: Partial<PeerRoutingChoice>): PeerRoutingChoice {
  return { change: 'block', peer: NODE, at_ms: AT, until_ms: null, capsule_id: 'c'.repeat(64), ...overrides }
}

describe('routableNodeId -- only a full node id from your own records can be blocked', () => {
  it('takes the 64-hex node id and nothing shorter or different', () => {
    expect(routableNodeId(withIdentity({ node_id: NODE, node_id_source: 'your_records' }))).toBe(NODE)
    expect(routableNodeId(withIdentity({ node_id: null, endpoint_id: 'e5ba9d1001', signing_key_id: OTHER }))).toBe(null)
    expect(routableNodeId(withIdentity({ node_id: 'a70d3967bea3b22f', node_id_source: 'your_records' }))).toBe(null)
    // The peer naming a node in its own record could name an honest one.
    expect(routableNodeId(withIdentity({ node_id: NODE, node_id_source: 'their_record' }))).toBe(null)
    // An older host that does not say where the id came from: not proven ours.
    expect(routableNodeId(withIdentity({ node_id: NODE }))).toBe(null)
    expect(routableNodeId(withIdentity(null))).toBe(null)
  })
})

describe('routingState -- what the local store says about one peer', () => {
  const blocked: PeerBlocksJson = {
    blocks: { [NODE]: { blocked_at_ms: AT, until_ms: AT + 7 * DAY } },
    choices: [choice({ until_ms: AT + 7 * DAY })]
  }

  it('a listed timed block is stopped until its end', () => {
    expect(routingState(NODE, blocked)).toMatchObject({ kind: 'stopped', untilMs: AT + 7 * DAY })
  })

  it('a block until undone has no end', () => {
    const untilUndone: PeerBlocksJson = {
      blocks: { [NODE]: { blocked_at_ms: AT, until_ms: null } },
      choices: [choice({})]
    }
    expect(routingState(NODE, untilUndone)).toMatchObject({ kind: 'stopped', untilMs: null })
  })

  it('another peer’s block never stops this one; no id is its own state', () => {
    expect(routingState(OTHER, blocked).kind).toBe('routing')
    expect(routingState(null, blocked).kind).toBe('no_node_id')
    expect(routingState(NODE, undefined)).toEqual({ kind: 'routing', last: null })
  })

  it('carries this peer’s latest choice, block or undo', () => {
    const undone: PeerBlocksJson = {
      blocks: {},
      choices: [choice({}), choice({ peer: OTHER }), choice({ change: 'unblock', at_ms: AT + DAY })]
    }
    const state = routingState(NODE, undone)
    expect(state).toMatchObject({ kind: 'routing', last: { change: 'unblock', at_ms: AT + DAY } })
  })
})

describe('the words', () => {
  it('says whose choice it is and where it applies, with the date or "until you undo it"', () => {
    expect(routingStateText({ kind: 'stopped', untilMs: AT + 7 * DAY, last: null })).toBe(
      'Stopped until 4 Oct, by your choice. Only on your node.'
    )
    expect(routingStateText({ kind: 'stopped', untilMs: null, last: null })).toBe(
      'Stopped until you undo it, by your choice. Only on your node.'
    )
    expect(routingStateText({ kind: 'routing', last: null })).toBe(ROUTING_BLOCK_COPY.routing)
    expect(routingStateText({ kind: 'routing', last: choice({ change: 'unblock' }) })).toBe(
      'You resumed routing to them on 27 Sep.'
    )
    expect(routingStateText({ kind: 'no_node_id' })).toBe(ROUTING_BLOCK_COPY.noNodeId)
  })

  it('says whether the choice is on your records, and never claims a record that was not sealed', () => {
    expect(recordText(choice({}))).toBe('The block is sealed on your records.')
    expect(recordText(choice({ change: 'unblock' }))).toBe('The undo is sealed on your records.')
    expect(recordText(choice({ capsule_id: null }))).toBe(
      'The block is not confirmed on your records yet. It still applies.'
    )
    expect(recordText(null)).toBe(null)
  })

  it('your dealings: counts with their denominators, disputes said as none when none were judged', () => {
    const [clean, alarmed] = HARNESS_PANE_B_PAYLOAD.rows
    expect(dealingsLines(clean)).toEqual([
      '24 exchanges with you · they confirmed 16 of 24',
      'Same request & answer: 16 · 0 differ',
      'Disputes judged: 8 of 24 · 8 corroborated'
    ])
    expect(dealingsLines(alarmed)[1]).toMatch(/· 1 differ$/)
    const unjudged: PaneBRow = { ...clean, verdicts: { state: 'NOT_CHECKED' } }
    expect(dealingsLines(unjudged)[2]).toBe('Disputes judged: none')
  })
})
