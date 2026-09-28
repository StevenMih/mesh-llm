import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }))

const { SeeInLogsLink } = await import('@/features/capsules/components/ExchangeIdCell')

afterEach(() => {
  cleanup()
  navigate.mockReset()
})

describe('u109: see in Logs from an exchange row', () => {
  it('opens Logs on the request carrying this exchange id', async () => {
    render(<SeeInLogsLink exchangeKey="0f8fad5b-d9cb-469f-a165-70867728950e" />)
    await userEvent.setup().click(screen.getByRole('button', { name: /see in Logs/ }))
    expect(navigate).toHaveBeenCalledWith({
      search: { focusExchangeId: '0f8fad5b-d9cb-469f-a165-70867728950e' },
      to: '/logs'
    })
  })

  it('shows nothing for a digest-keyed row, which no Logs request carries', () => {
    render(<SeeInLogsLink exchangeKey="digest:abc" />)
    expect(screen.queryByRole('button', { name: /see in Logs/ })).not.toBeInTheDocument()
  })
})
