// The Evidence tab's hover copy, in one place ([mesh-evidence-tooltips-complete],
// UX review §8). One tooltip per chip TYPE, shared by every instance of it, so
// the census test (`tooltip-census.test.tsx`) can check each one: present,
// one plain sentence or two, no retired phrase, and -- outside Dig (the checks
// panel) -- none of the engineer's words ("half", "capsule id", "leaves",
// "recomputed"). Say what a thing is, never what it isn't: a banned word stays
// off the screen even to deny it.
//
// The Peers column and Integrity tile NAMES are unchanged here; their renames
// land with [mesh-evidence-plain-language-pass]. Every sentence below reads
// correctly under either name.

/** Hero chips (the InfoBanner's status row). */
export const HERO_TOOLTIPS = {
  live: 'Reading this node’s records over its running local API. They update as this node seals them.',
  local: 'Reading a saved local copy. This node’s API is not connected, so the records are not updating.',
  sample: 'Showing a saved sample run, not this node’s records. Nothing here updates.',
  yourRecords: 'The records this node keeps, sealed and checkpointed. Open to see where they are and what you share.',
  // [mesh-evidence-hero-your-history-and-cleanup]: the storage-posture pills,
  // mirroring Logs. Facts, not features.
  // Shown only when every switch under What you share is off.
  localOnly: 'Nothing is sent from this machine: every switch under What you share is off.',
  digestsOnly: 'Each record holds a fingerprint of the prompt and the answer, never the words themselves.',
  promptsKept: 'The words of your prompts and answers are stored on this machine only, apart from the records.',
  promptsNotKept: 'No prompt or answer text is stored on this machine. The records hold fingerprints only.',
  promptsUnknown: 'This view can’t tell whether prompt and answer text is stored on this machine.'
} as const

/** p2 item 3: the owner-link fact, worded once for Integrity's step 2 and
 *  the checks panel's binding fact. */
export const OWNER_LINKED_PHRASE = 'linked to your owner account (self-asserted)'
export const OWNER_NOT_LINKED_PHRASE = 'not linked to an owner'

/** p2 item 5: why an action is disabled -- said on hover, never a silent grey. */
export const SAMPLE_DATA_UNAVAILABLE = 'Not available on sample data.'

/** The InfoBanner description under the tab title. */
export const HERO_DESCRIPTION = 'Everything here is checked on this machine, from sealed records.'

/** Peers table column headers. */
export const PEER_COLUMN_TOOLTIPS = {
  exchanges: 'Distinct exchanges with this peer. Your record and theirs of the same exchange count once.',
  confirmed: 'How many of your exchanges with them are confirmed by their own signed record, checked on this machine.',
  match:
    'Their record and yours hold the same request and the same answer. A difference means the two records disagree.',
  adjudication:
    'Times someone compared this peer’s answers to another’s and sealed a verdict, and how many they looked at.',
  witness:
    'Whether this peer’s records are held by a witness they don’t run. Not shown yet: this view doesn’t have that data.',
  period: 'The date of your latest exchange with this peer.'
} as const

/** The peer's self-reported identity note. */
export const SELF_REPORTED_TOOLTIP =
  'This identity is self-reported: it’s what the peer says about itself. Only the records they signed, checked on this machine, count as evidence.'

/** The one line at the top of the peer inspector. */
export const PEER_INSPECTOR_HEADER =
  'What you’ve recorded with this peer. Their log, as shown to you, is what they and others let you see.'

/** [mesh-evidence-history-surface] The peer drill's "Their history" sections
 *  (UX review §7.2 names). One tooltip per section heading. */
export const PEER_HISTORY_TOOLTIPS = {
  dealings: 'Your exchanges with this peer, and how many of them their own signed record confirms.',
  theirLog:
    'Their log as your node fetched and checked it: counts per checkpoint, no record contents. Witnesses a checkpoint lists are shown as listed, not checked here.',
  othersSay: 'What the nodes you asked about this peer said. A node that answered with a refusal still answered.',
  verdicts:
    'Verdicts on exchanges this peer took part in; a verdict can find against either side. Each column is counted on its own and never added to another.',
  askedOfYou: 'Requests your node logged from a node naming itself as this peer, and what your node did with each one.'
} as const

/** Peer attention badges -- the specific thing, counted, replacing the old
 *  generic ⚠ alarm chip. Each is one sentence naming exactly that. */
export const PEER_ATTENTION = {
  disagreements: {
    label: (n: number) => `${n} disagreement${n === 1 ? '' : 's'}`,
    tooltip: (n: number) => `${n} exchange${n === 1 ? '' : 's'} where your record and theirs disagree.`
  },
  differingAnswers: {
    label: (n: number) => `${n} differing answer${n === 1 ? '' : 's'}`,
    tooltip: (n: number, when?: string | null) =>
      `${n === 1 ? '1 sealed comparison' : `${n} sealed comparisons`} found this peer’s answer differed from another machine’s.${
        when ? ` Latest: ${when}.` : ''
      }`
  },
  logFailed: {
    label: () => 'log didn’t check out',
    tooltip: () => 'Their log, as shown to you, did not check out on this machine.'
  },
  refused: {
    label: () => 'refused a request',
    tooltip: () => 'They declined a request and signed the refusal.'
  }
} as const

/** The row's state badge: the (i) beside CLOSED / CONTRADICTED / OPEN. */
export const ROW_STATE_TOOLTIPS = {
  closed:
    'They sent their own signed record of this exchange. It checks out on this machine, and it has the same request and answer as yours.',
  contradicted: 'You both have a record of this exchange, and they disagree about the request or the answer.',
  open_refused:
    'They declined to share their record and signed the refusal. The refusal is the evidence; the exchange stays open.',
  open_absent:
    'They say they have no record of this exchange. That is their statement; there is nothing of theirs to check.',
  open_asked: 'You asked for their record and no reply has arrived yet.',
  open_not_held: 'Their record of this exchange hasn’t arrived yet. It usually comes when the exchange finishes.',
  open_not_given: 'Their record of this exchange hasn’t arrived yet, and they didn’t send an id to ask for it by.',
  open_not_asked: 'You haven’t asked them for their record.'
} as const

/** The per-property cells a CLOSED row shows, each with its own (i). */
export const CLOSED_CELL_TOOLTIPS = {
  their_id: 'The id of their record; it’s a fingerprint of the record itself.',
  signature: 'Signed with the key this peer announces.',
  request: 'The same request as in your record.',
  response: 'The same answer as in your record.'
} as const

/** [mesh-chat-evidence-chip] The chip under an assistant message in Chat,
 *  one per state it can show. A click opens the exchange in Evidence. */
export const CHAT_EVIDENCE_CHIP_TOOLTIPS = {
  confirmed:
    'This node sealed a record of this exchange. The other side sent their own signed record, it checks out on this machine, and it has the same request and answer.',
  awaiting: 'This node sealed a record of this exchange. The other side’s record hasn’t arrived yet.',
  differs:
    'This node sealed a record of this exchange. The other side’s record disagrees about the request or the answer.',
  declined:
    'This node sealed a record of this exchange. The other side declined to share theirs and signed the refusal.',
  they_have_none: 'This node sealed a record of this exchange. The other side says they have no record of it.'
} as const

/** [mesh-chat-evidence-chip] The link on a Logs request row, shown only when a
 *  sealed record this node holds names the row's exchange id. */
export const LOGS_EVIDENCE_LINK_TOOLTIP = 'Open the sealed record of this exchange in Evidence.'

/** The row's chip strip (`content · sig · inclusion · registered · theirs`).
 *  Hover gives the meaning; a click still opens the full check. */
export const ENTRY_CHIP_TOOLTIPS = {
  content: 'Whether this record still matches its id, checked on this machine.',
  sig: 'Whether this record is signed with the key its node announces.',
  inclusion: 'Whether a checkpoint on this node covers this record.',
  registered: 'Whether a witness you don’t run holds a checkpoint covering this record.',
  theirs: 'Whether the other side’s own signed record confirms this exchange.'
} as const

/** The `in a checkpoint ◐` chip: covered, but the proof is not checked here. */
export const ENTRY_CHIP_COVERED_TOOLTIP =
  'A checkpoint on this node covers this record, as Integrity counts. This view has not checked its inclusion proof.'

/** The TWIN bracket's `no verdict` badge. */
export const TWIN_NO_VERDICT_TOOLTIP =
  'The same request went to two machines and both answers are recorded. No one has compared them and sealed a verdict yet.'

/** The one wording for "no witness holds your checkpoints": the hero, the
 *  Your records panel and the Integrity tile all say this. */
export const WITNESS_OFF = 'witness off — your choice'

/** Integrity tiles. */
export const INTEGRITY_TILE_TOOLTIPS = {
  sealed:
    'Records this node has sealed into its own chain, checked on this machine. It says nothing about whether their contents are true.',
  sharedWithWitness:
    'How many of your checkpoints a witness you don’t run is holding. Off by your choice until you turn one on.',
  confirmedByOtherSide: 'Exchanges the other side confirmed with their own signed record, checked on this machine.',
  contradicted: 'Exchanges where your record and theirs disagree.'
} as const

/** Integrity's chain coverage strip. */
export const CHAIN_STRIP_TOOLTIP =
  'Shaded: records sealed into a checkpoint. Unshaded: records sealed since the last checkpoint.'

/** The checks panel's chips (Dig), one per property. Hover for the meaning;
 *  a click still opens the four-part explanation (v3 §4). Dig may use the
 *  exact terms, but each hover is still one plain sentence. */
export const CHECK_CHIP_TOOLTIPS: Record<string, string> = {
  content_binding: 'Whether the record’s contents still match its id.',
  producer_signature: 'Whether the record is signed with the key its node announces.',
  task_binding: 'Whether the record is tied to the request it answers.',
  local_inclusion: 'Whether a checkpoint on the node that sealed it covers this record.',
  checkpoint_signature: 'Whether that checkpoint is signed by the node that made it.',
  external_registration: 'Whether a witness that node doesn’t run holds the checkpoint.',
  continuity: 'Whether that checkpoint binds to the one before it.',
  outcome_corroboration: 'Whether the other side’s own record confirms what happened.',
  'identity_authority:binding': 'Whether the signing key is bound to an owner identity.',
  'identity_authority:authority': 'Whether that owner identity is bound to a person.'
}

export function checkChipTooltipKey(propertyKey: string, factKey?: 'binding' | 'authority'): string {
  return factKey ? `${propertyKey}:${factKey}` : propertyKey
}

/** Payments on an exchange row: the `paid` chip and its settlement state.
 *  Only this node's records exist, so every sentence is about your side. */
export const SETTLEMENT_PRICED_TOOLTIP = 'This exchange was priced, and no invoice was recorded for it.'

export const SETTLEMENT_PAID_TOOLTIP =
  'This exchange was priced, and this node recorded each payment step it saw. The wallet keeps the money; these are the records.'

export const SETTLEMENT_STATE_TOOLTIPS = {
  settled:
    'Every invoice you saw for this exchange was reported paid by your wallet, under the same payment reference.',
  settled_without_reference:
    'Your wallet reported each invoice’s part of this exchange paid, but at least one report carried no payment reference to match on.',
  no_settlement_seen: 'At least one invoice has no payment reported by your wallet. Your records alone can’t say why.',
  terms_only: 'You accepted the terms, and no invoice was recorded.',
  unmatched_settlement: 'Your wallet reported a payment that no invoice for this exchange names.'
} as const

export const SETTLEMENT_PROVIDER_BOOK_TOOLTIP =
  'The provider’s own record of this payment isn’t shared with this node, so only your side is shown.'

/** Who stated each recorded payment value. */
export const SETTLEMENT_SOURCE_TOOLTIPS = {
  payer_asserted: 'Recorded by this node as what it agreed to or accounted.',
  provider_asserted: 'What the provider stated, as it reached this node.',
  wallet_reported: 'What your wallet reported.'
} as const

/** The Peers row's payments line. */
export const PEER_PAYMENTS_TOOLTIP =
  'Counts of your paid exchanges with this peer, from your own records. Lapsed payments and debts are kept in the provider’s book, which this node doesn’t have.'

/** Integrity's Close card. */
export const CLOSE_CARD_TOOLTIP =
  'Counts over the exchanges shown here: how many the other side confirmed, and how many were paid and settled by your wallet.'

/** §7.5: the peer drill's routing section and its dialog. Local only, undoable,
 *  and nobody is told; never a report, never a shared list. */
export const ROUTING_BLOCK_COPY = {
  sectionTitle: 'Routing to this peer',
  routing: 'Your node sends requests to them as usual.',
  noNodeId: 'Your own records don’t name this peer’s node id yet, so there is nothing to stop routing to.',
  stopAction: 'Stop routing to this peer',
  resumeAction: 'Resume routing',
  dialogTitle: 'Stop routing to this peer?',
  dialogLines: ['This is only on your node.', 'Nobody else is told.', 'You can undo it.'],
  dialogDetail: 'Your node stops sending requests to them. They can still send requests to you.',
  blockSevenDays: 'Block for 7 days',
  blockUntilUndone: 'Block until I undo',
  failed: 'That didn’t go through. The line above shows what is in force now.'
} as const

/** §7.2/§7.5: the drill section about what happened between you and this peer. */
export const YOUR_DEALINGS_TITLE = 'Your dealings with them'

/** The Peers row chip while routing to a peer is stopped. */
export const ROUTING_STOPPED_LABEL = 'routing stopped'
export const ROUTING_STOPPED_TOOLTIP =
  'Your node isn’t sending requests to this peer, by your choice. Nobody else is told.'
