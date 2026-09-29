// u115 "Chat with this node": from a Peers drill or an exchange row, point this
// console's chats at one node (host-side, `/api/route-target`) and open Chat.
// While it is set, the button says so and offers the way back to automatic.
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import type { RouteTargetControls } from '@/features/capsules/api/useRouteTarget'
import { CHAT_TARGET_COPY } from '@/features/capsules/lib/tooltip-copy'

export function ChatWithNodeButton({ nodeId, controls }: { nodeId: string; controls: RouteTargetControls }) {
  const navigate = useNavigate()
  const { target, chatWith, clear } = controls
  const [failed, setFailed] = useState(false)
  if (target === nodeId) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2" data-chat-target="this-node">
        <span className="text-xs text-fg-dim">{CHAT_TARGET_COPY.active}</span>
        <Button onClick={clear} size="sm" type="button" variant="outline">
          {CHAT_TARGET_COPY.clear}
        </Button>
      </span>
    )
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        onClick={(event) => {
          event.stopPropagation()
          setFailed(false)
          chatWith(nodeId).then(
            () => navigate({ to: '/chat' }),
            () => setFailed(true)
          )
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        {CHAT_TARGET_COPY.action}
      </Button>
      {failed ? <span className="text-xs text-fg-faint">{CHAT_TARGET_COPY.failed}</span> : null}
    </span>
  )
}
