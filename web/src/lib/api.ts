const TOKEN_KEY = 'harbour.token'

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* private browsing - the session simply will not be remembered */
  }
}

export class ApiError extends Error {
  status: number
  /** Anything else the server sent alongside the message — the setup
   *  checklist a 503 carries, for instance. */
  detail?: Record<string, unknown>
  constructor(status: number, message: string, detail?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.detail = detail
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const response = await fetch(path, {
    method,
    headers,
    // Cloudflare Access identifies the caller with a cookie, so the request
    // has to carry credentials even though it is same-origin.
    credentials: 'same-origin',
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  if (response.status === 401) {
    setToken(null)
    // Do not bounce to a login page here: with Access there is no page to
    // bounce to, and the auth provider decides what happens next.
    throw new ApiError(401, 'Your session has expired. Please sign in again.')
  }

  if (!response.ok) {
    let message = 'Something went wrong. Please try again.'
    let detail: Record<string, unknown> | undefined
    try {
      const payload = await response.json()
      if (payload && typeof payload.message === 'string') message = payload.message
      if (payload && typeof payload === 'object') detail = payload as Record<string, unknown>
    } catch {
      /* response had no JSON body */
    }
    throw new ApiError(response.status, message, detail)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T>(path: string) => request<T>('DELETE', path),
}
