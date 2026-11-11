const API_BASE = 'https://api.ynab.com/v1'

export class YnabApiError extends Error {
  readonly status: number
  readonly retryable: boolean

  constructor(
    message: string,
    status: number,
    retryable: boolean,
  ) {
    super(message)
    this.name = 'YnabApiError'
    this.status = status
    this.retryable = retryable
  }
}

export async function ynabGet<T>(
  token: string,
  path: string,
  query: Record<string, string | number | undefined> = {},
): Promise<T> {
  const url = new URL(`${API_BASE}${path}`)
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(25_000),
    })
  } catch {
    throw new YnabApiError('Não foi possível conectar à API do YNAB.', 0, true)
  }

  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500
    const message = response.status === 401
      ? 'O token do YNAB foi rejeitado. Atualize o secret do Worker.'
      : response.status === 429
        ? 'O YNAB limitou temporariamente as chamadas. Tente novamente.'
        : `A API do YNAB respondeu com erro ${response.status}.`
    throw new YnabApiError(message, response.status, retryable)
  }

  return response.json() as Promise<T>
}
