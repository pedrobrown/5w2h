import { afterEach, describe, expect, it, vi } from 'vitest'
import { ynabGet, YnabApiError } from '../src/ynab/client'

afterEach(() => vi.unstubAllGlobals())

describe('YNAB API client', () => {
  it('sends the bearer token only to YNAB and preserves explicit history ranges', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ data: { transactions: [] }, server_knowledge: 19 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await ynabGet<{ server_knowledge: number }>('unit-test-token', '/plans/plan-1/transactions', {
      since_date: '2010-01-01', until_date: '2010-12-31',
    })

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(requestUrl)).toContain('since_date=2010-01-01')
    expect(String(requestUrl)).toContain('until_date=2010-12-31')
    expect(new Headers(requestInit.headers).get('Authorization')).toBe('Bearer unit-test-token')
    expect(JSON.stringify(result)).not.toContain('unit-test-token')
    expect(result.server_knowledge).toBe(19)
  })

  it('does not expose upstream response bodies when a PAT is rejected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('sensitive upstream payload', { status: 401 })))
    await expect(ynabGet('unit-test-token', '/plans')).rejects.toMatchObject<Partial<YnabApiError>>({
      status: 401,
      retryable: false,
      message: 'O token do YNAB foi rejeitado. Atualize o secret do Worker.',
    })
  })

  it('marks rate limits as retryable without returning API details', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('private details', { status: 429 })))
    await expect(ynabGet('unit-test-token', '/plans')).rejects.toMatchObject<Partial<YnabApiError>>({
      status: 429,
      retryable: true,
      message: 'O YNAB limitou temporariamente as chamadas. Tente novamente.',
    })
  })
})
