// [mesh-evidence-hero-your-history-and-cleanup] The Evidence hero's words, the
// `Your records` panel and the `Clean up records` dialog (UX review 2026-09-26
// §1, names per §7.2: "Your records", "What you share"; "history" is a
// rejected word for this node's own records, so option 3 is "Start a new log").
// Pure, so every sentence is unit-testable and the census can read it.
import type {
  CleanupAction,
  CleanupResult,
  RecordsStatus,
  SharingSwitchKey
} from '@/features/capsules/api/recordsClient'
import { HERO_TOOLTIPS, SAMPLE_DATA_UNAVAILABLE } from '@/features/capsules/lib/tooltip-copy'

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

// ---------------------------------------------------------------------------
// Hero line 3: the whole tab in one sentence
// ---------------------------------------------------------------------------

export type HeroCounts = {
  records: number
  confirmed: number
  disagreements: number
  /** A witness this node doesn't run holds a checkpoint. */
  witnessed: boolean
}

/** "8 records · 3 confirmed by the other side · 0 disagreements · checkable
 *  only by you (no witness)". The same counts the Integrity tiles show, from
 *  the same predicate, so the two can't disagree. */
export function heroStatusLine(counts: HeroCounts): string {
  return [
    plural(counts.records, 'record'),
    `${counts.confirmed} confirmed by the other side`,
    plural(counts.disagreements, 'disagreement'),
    counts.witnessed ? 'also held by a witness you don’t run' : 'checkable only by you (no witness)'
  ].join(' · ')
}

// ---------------------------------------------------------------------------
// The storage-posture pills
// ---------------------------------------------------------------------------

export type PromptsPill = { label: string; tooltip: string; census: string }

/** `Your prompts · kept here | not kept`: whether the words exist anywhere on
 *  this machine. `null` = this view couldn't find out, said as such. */
export function promptsPill(storedTextCount: number | null): PromptsPill {
  if (storedTextCount === null) {
    return { label: 'Your prompts · not shown', tooltip: HERO_TOOLTIPS.promptsUnknown, census: 'hero:prompts_unknown' }
  }
  return storedTextCount > 0
    ? { label: 'Your prompts · kept here', tooltip: HERO_TOOLTIPS.promptsKept, census: 'hero:prompts_kept' }
    : { label: 'Your prompts · not kept', tooltip: HERO_TOOLTIPS.promptsNotKept, census: 'hero:prompts_not_kept' }
}

// ---------------------------------------------------------------------------
// What you share: the four switches, one "what leaves" sentence each
// ---------------------------------------------------------------------------

export type SharingRow = {
  key: SharingSwitchKey
  label: string
  /** The setting in words, or null when this view doesn't have it. */
  state: string | null
  /** Where it was set: by the owner, or the default. */
  source: 'set' | 'default' | null
  whatLeaves: string
}

const SHARING_LABELS: Record<SharingSwitchKey, string> = {
  record_at_completion: 'Your record, when an exchange finishes',
  history_segments: 'Your log, when someone asks',
  adjudications: 'Verdicts you seal',
  witness: 'Witness'
}

const SHARING_ORDER: readonly SharingSwitchKey[] = [
  'record_at_completion',
  'history_segments',
  'adjudications',
  'witness'
]

function describeSwitch(key: SharingSwitchKey, value: string | null): { state: string; whatLeaves: string } {
  switch (key) {
    case 'record_at_completion':
      return value === 'off'
        ? {
            state: 'off',
            whatLeaves: 'Nothing is sent when an exchange finishes. The other side can still ask for your record.'
          }
        : {
            state: 'to the other side',
            whatLeaves: 'Your signed record of an exchange goes to the other side of that exchange, and no one else.'
          }
    case 'history_segments': {
      const to: Record<string, string> = {
        counterparties: 'nodes you’ve dealt with',
        prospective: 'nodes you’ve dealt with or are about to',
        peers: 'any node that asks'
      }
      if (value === 'off' || !value || !to[value]) {
        return { state: 'off', whatLeaves: 'Nothing is sent: requests for your log are declined.' }
      }
      return {
        state: `to ${to[value]}`,
        whatLeaves: `Counts from your checkpoints, never records or text, go to ${to[value]}.`
      }
    }
    case 'adjudications':
      return value === 'off'
        ? { state: 'off', whatLeaves: 'Nothing is sent: verdicts you seal stay on this machine.' }
        : { state: 'to the node it’s about', whatLeaves: 'A verdict you seal goes to each node it is about.' }
    case 'witness':
      return value
        ? { state: 'on', whatLeaves: `Your checkpoints, never records or text, go to ${value}.` }
        : { state: 'off', whatLeaves: 'Nothing is sent: no witness is set.' }
  }
}

export const SHARING_NOT_SHOWN = 'Its setting isn’t shown here.'

/** The four rows. Without a status (sample data, or the node didn't answer),
 *  each row says what the switch governs and that its setting isn't shown. */
export function sharingRows(status: RecordsStatus | null): SharingRow[] {
  return SHARING_ORDER.map((key) => {
    const current = status?.sharing?.[key]
    if (!current) {
      return {
        key,
        label: SHARING_LABELS[key],
        state: null,
        source: null,
        whatLeaves: SHARING_NOT_SHOWN
      }
    }
    const described = describeSwitch(key, current.value)
    return { key, label: SHARING_LABELS[key], source: current.source, ...described }
  })
}

/** Each switch's hover: what it governs, whatever it's set to. */
export const SHARING_GOVERNS: Record<SharingSwitchKey, string> = {
  record_at_completion: 'Governs whether your signed record of an exchange goes to the other side when it finishes.',
  history_segments: 'Governs who may receive counts from your checkpoints when they ask.',
  adjudications: 'Governs whether a verdict you seal goes to the node it is about.',
  witness: 'Governs whether your checkpoints go to a witness you don’t run.'
}

// ---------------------------------------------------------------------------
// Clean up records: exactly three options, each with its consequence
// ---------------------------------------------------------------------------

export type CleanupOption = { action: CleanupAction; title: string; consequence: string; button: string }

export const CLEANUP_OPTIONS: readonly CleanupOption[] = [
  {
    action: 'delete_stored_text',
    title: 'Delete stored prompt and answer text',
    consequence:
      'Your records keep their fingerprints and stay valid. You can no longer show anyone the words of those exchanges.',
    button: 'Delete stored text'
  },
  {
    action: 'rebuild_index',
    title: 'Rebuild the index',
    consequence:
      'Re-reads and re-checks every record, and rebuilds what this node uses to look them up. Nothing is lost.',
    button: 'Rebuild index'
  },
  {
    action: 'start_new_log',
    title: 'Start a new log',
    consequence:
      'Your current records are archived whole, and a new log begins the next time this node starts. Nodes that already hold your checkpoint will see a new log, and anything you already shared stays with them.',
    button: 'Start a new log'
  }
] as const

/** Said once in the dialog, because the question will be asked. */
export const NO_SINGLE_RECORD_DELETE =
  'Records can’t be edited or removed one at a time. Removing one would break the chain, and anyone checking it would see that.'

export const CLEANUP_IS_ON_THE_RECORD = 'Each cleanup seals a record of itself onto your log.'

/** Why the run button can't act right now, or null when it can. */
export function cleanupBlockedReason(
  action: CleanupAction,
  { sample, status, confirmed }: { sample: boolean; status: RecordsStatus | null; confirmed: boolean }
): string | null {
  if (sample) return SAMPLE_DATA_UNAVAILABLE
  if (!status) return 'This node didn’t answer, so nothing can be cleaned up from here.'
  if (action === 'start_new_log') {
    if (status.new_history_pending) return NEW_LOG_PENDING
    if (!confirmed) return 'Tick the box above to confirm.'
  }
  return null
}

export const START_NEW_LOG_CONFIRM = 'I understand my current records will be archived and a new log will begin.'

export function cleanupResultMessage(result: CleanupResult): string {
  switch (result.action) {
    case 'delete_stored_text':
      return result.sealed
        ? `Deleted the stored text of ${plural(result.deleted_count, 'record')}. Sealed as record ${result.sealed.record_number}.`
        : 'There was no stored text to delete, so nothing was sealed.'
    case 'rebuild_index':
      return `Checked ${plural(result.records_checked, 'record')}; the index is rebuilt. Sealed as record ${result.sealed.record_number}.`
    case 'start_new_log':
      return `Sealed as record ${result.sealed.record_number}, the last of this log. The new log begins the next time this node starts.`
  }
}

// ---------------------------------------------------------------------------
// The Your records panel's facts
// ---------------------------------------------------------------------------

export function recordsLocationFact(status: RecordsStatus | null, sample: boolean): string {
  if (status) return status.records_path
  return sample ? 'Not shown on sample data.' : 'Not shown: this node didn’t say.'
}

export function lastCheckpointFact(coveredRecords: number | null, noLaterThan: string | null): string {
  if (coveredRecords === null || coveredRecords === 0) return 'No checkpoint yet.'
  const covers = `Covers ${plural(coveredRecords, 'record')}`
  return noLaterThan ? `${covers}, made no later than ${noLaterThan}.` : `${covers}.`
}

export const NEW_LOG_PENDING = 'A new log begins the next time this node starts.'
