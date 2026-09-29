import { describe, expect, it } from 'vitest'
import { chatTargetFromSearch, chatTargetLabel } from '@/features/chat/api/chat-target'

const NODE = 'a70d3967bea3b22fa48a28f77c5d2b3764fc8bd5204a82c09ff8430f3f2a0a00'

describe('chatTargetFromSearch', () => {
  it('reads a full node id from ?target=, lower-cased', () => {
    expect(chatTargetFromSearch(`?target=${NODE.toUpperCase()}`)).toBe(NODE)
    expect(chatTargetFromSearch(`?model=m&target=${NODE}`)).toBe(NODE)
  })

  it('ignores anything that is not a full node id, so chats stay automatic', () => {
    for (const search of ['', '?target=', '?target=abc', `?target=${NODE}0`, '?target=node:a70d3967']) {
      expect(chatTargetFromSearch(search)).toBeNull()
    }
  })

  it('names the node short in the header', () => {
    expect(chatTargetLabel(NODE)).toBe('to node a70d3967… only')
  })
})
