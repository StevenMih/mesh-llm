// `?target=<node id>` on the chat page: send this page's chats to one node,
// through the existing `x-mesh-target` header. A node that doesn't serve the
// chosen model answers 409; the chat is never sent anywhere else. Only a full
// endpoint id (64 hex) counts; anything else is ignored, so chats stay
// automatic.
const NODE_ID = /^[0-9a-f]{64}$/

export function chatTargetFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get('target')?.trim().toLowerCase() ?? ''
  return NODE_ID.test(value) ? value : null
}

/** The header subtitle's words while chats are pinned to one node. */
export function chatTargetLabel(target: string): string {
  return `to node ${target.slice(0, 8)}… only`
}
