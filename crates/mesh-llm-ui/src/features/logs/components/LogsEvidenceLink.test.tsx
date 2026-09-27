import '@testing-library/jest-dom/vitest'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PaneCRow } from '@/features/capsules/api/sidecarTypes'
import { LOGS_EVIDENCE_LINK_TOOLTIP } from '@/features/capsules/lib/tooltip-copy'
import { LogsEvidenceLink } from '@/features/logs/components/LogsEvidenceLink'
import { DataModeContext, type DataMode } from '@/lib/data-mode/data-mode-context'

vi.mock('@/features/capsules/api/sidecarClient', () => ({ fetchPaneCList: vi.fn() }))
vi.mock('@/features/capsules/api/client', () => ({ fetchCapsuleLedger: vi.fn() }))

const EXCHANGE_ID = '956801c1-df95-4942-8642-5b9b570663a4'
const DIGEST = 'e8eef2160368ef789274811e3d3391da1e6e0abf37967ea145430ab20195c1cc'
const ROW_KEY = `digest:${DIGEST}`

// The host-served row and record as the freeze-candidate capture holds them.
const SERVED_ROW: PaneCRow = {
  exchange_key: ROW_KEY,
  role_tag: 'SERVED',
  counterparty: 'key:71eb26f8e583ccc9',
  header_state: 'absent',
  properties: null,
  has_issue: false,
  mine: { state: 'present-unverified', capsule_id: '06844fdf1e46479554eef765a7cd4b2eb9cf1f7ccec4536a858567b11a80b2f4' },
  theirs: { state: 'absent', capsule_id: null },
  unilateral: true,
  timestamp: '2026-09-26T05:06:17.742Z'
}
const SERVED_RECORD = {
  capsule_id: '06844fdf1e46479554eef765a7cd4b2eb9cf1f7ccec4536a858567b11a80b2f4',
  effect: { request_digest: DIGEST },
  model_attestation: {
    compute_attestation: { 'x-mesh-poc-v1': { serving_provenance: { exchange_id: EXCHANGE_ID } } }
  }
}

function renderLink(exchangeId: string, mode: DataMode = 'live', onRowClick = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <DataModeContext.Provider value={{ mode, setMode: () => undefined }}>{children}</DataModeContext.Provider>
      </QueryClientProvider>
    )
  }
  render(
    <div onClick={onRowClick}>
      <LogsEvidenceLink exchangeId={exchangeId} />
    </div>,
    { wrapper: Wrapper }
  )
  return onRowClick
}

async function bothReadsLanded() {
  const { fetchPaneCList } = await import('@/features/capsules/api/sidecarClient')
  const { fetchCapsuleLedger } = await import('@/features/capsules/api/client')
  await waitFor(() => expect(vi.mocked(fetchPaneCList)).toHaveBeenCalled())
  await waitFor(() => expect(vi.mocked(fetchCapsuleLedger)).toHaveBeenCalled())
  await Promise.all([
    vi.mocked(fetchPaneCList).mock.results[0].value,
    vi.mocked(fetchCapsuleLedger).mock.results[0].value
  ])
  // Give the resolved data a render pass before asserting absence.
  await new Promise((resolve) => setTimeout(resolve, 50))
}

describe('LogsEvidenceLink ([mesh-chat-evidence-chip])', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { fetchPaneCList } = await import('@/features/capsules/api/sidecarClient')
    const { fetchCapsuleLedger } = await import('@/features/capsules/api/client')
    vi.mocked(fetchPaneCList).mockResolvedValue({
      rows: [SERVED_ROW],
      row_count: 1,
      default_sort: 'timestamp',
      filters: [],
      next_after_seq: null,
      archived_segments: []
    })
    vi.mocked(fetchCapsuleLedger).mockResolvedValue({ records: [SERVED_RECORD], nodePubKeyPem: null })
  })

  it('shows once a sealed record names the exchange id, links to its row, and does not open the inspector', async () => {
    const onRowClick = renderLink(EXCHANGE_ID)

    const link = await screen.findByRole('link', { name: `Open exchange ${EXCHANGE_ID} in Evidence` })
    expect(link).toHaveAttribute('href', `/capsules/exchange/${encodeURIComponent(ROW_KEY)}`)
    expect(link).toHaveAttribute('title', LOGS_EVIDENCE_LINK_TOOLTIP)

    fireEvent.click(link)
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('shows nothing for an exchange id no sealed record names, after both reads have landed', async () => {
    renderLink('0b7c9a52-3f0e-4d6a-9c1e-2f4b8d7e6a10')

    await bothReadsLanded()
    expect(screen.queryByTestId('logs-row-evidence-link')).not.toBeInTheDocument()
  })

  it('shows nothing while the Evidence reads have not landed', () => {
    renderLink(EXCHANGE_ID)
    expect(screen.queryByTestId('logs-row-evidence-link')).not.toBeInTheDocument()
  })

  it('shows nothing in harness mode, and reads nothing', async () => {
    const { fetchPaneCList } = await import('@/features/capsules/api/sidecarClient')
    renderLink(EXCHANGE_ID, 'harness')

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByTestId('logs-row-evidence-link')).not.toBeInTheDocument()
    expect(vi.mocked(fetchPaneCList)).not.toHaveBeenCalled()
  })
})
