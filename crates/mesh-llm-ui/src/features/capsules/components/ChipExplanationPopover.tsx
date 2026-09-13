// [ledger-T3-vocabulary-and-states] v3 §4: every chip opens the four-part
// explanation on click -- a popover anchored to the chip, never a modal
// (same "inline, never a dialog" rule the rest of this view lives by).
import type { ReactNode } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { ChecksSideCell } from '@/features/capsules/lib/security-checks-view'
import { explanationFor } from '@/features/capsules/lib/chip-explanation'

export function ChipExplanationPopover({
  propertyKey,
  cell,
  factKey,
  children
}: {
  propertyKey: string
  cell: ChecksSideCell
  factKey?: 'binding' | 'authority'
  children: ReactNode
}) {
  const explanation = explanationFor(propertyKey, cell, factKey)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="ui-control cursor-pointer appearance-none border-0 bg-transparent p-0 text-left"
          type="button"
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent className="flex flex-col gap-2 text-xs" data-chip-explanation={propertyKey}>
        <p>
          <span className="font-medium text-fg-faint">What this means: </span>
          {explanation.whatItMeans}
        </p>
        <p>
          <span className="font-medium text-fg-faint">What this view found: </span>
          {explanation.whatThisFound}
        </p>
        <p>
          <span className="font-medium text-fg-faint">What it does not establish: </span>
          {explanation.whatItDoesNotEstablish}
        </p>
        <p>
          <span className="font-medium text-fg-faint">How to change it: </span>
          {explanation.howToChange}
        </p>
      </PopoverContent>
    </Popover>
  )
}
