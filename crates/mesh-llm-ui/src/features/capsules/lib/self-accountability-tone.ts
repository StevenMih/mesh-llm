// Colour discipline for Pane A ("This node") rows
// ([mesh-pane-a-self-accountability-tab], green=silence / grey=distinct
// labeled state / red=a specific failed check, never yellow): a row is
// GREEN only when it has an affirmative, checked-good state (fully sealed,
// unbroken+witnessed history, a verified rung). A row is GREY when the
// fact is honestly absent, pending, or not-yet-available -- never blended
// with green. A row is RED only for a specific named failure (unsealed
// requests, a broken/forked history, a contradicted adjudication) -- never
// a vague warning.
import type { SelfAccountabilityCard } from '@/features/capsules/api/types'

export type Tone = 'green' | 'grey' | 'red'

export function sealingTone(sealing: SelfAccountabilityCard['sealing']): Tone {
  return sealing.unsealed_count === 0 ? 'green' : 'red'
}

export function historyTone(history: SelfAccountabilityCard['history']): Tone {
  if (history.checkpoint_count === 0) return 'grey'
  if (!history.unforked || history.continuity !== 'unbroken') return 'red'
  return history.witnessed ? 'green' : 'grey'
}

export function adjudicationsTone(adjudications: SelfAccountabilityCard['adjudications']): Tone {
  if (adjudications.contradicted > 0) return 'red'
  if (adjudications.corroborated > 0) return 'green'
  return 'grey'
}
