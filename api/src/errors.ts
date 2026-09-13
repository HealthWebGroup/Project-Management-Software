import type { Context } from 'hono'

export class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }

  static notFound(what: string) {
    return new HttpError(404, `${what} not found`)
  }

  static forbidden(message: string) {
    return new HttpError(403, message)
  }

  static badRequest(message: string) {
    return new HttpError(400, message)
  }

  static unauthorised(message = 'Please sign in again.') {
    return new HttpError(401, message)
  }
}

/**
 * One error shape for the whole API. Internal detail goes to the log, never
 * to the caller - a stack trace in a response is a gift to an attacker.
 */
export function onError(error: Error, c: Context) {
  if (error instanceof HttpError) {
    return c.json({ status: error.status, message: error.message }, error.status as 400)
  }
  console.error('Unhandled error', error?.stack ?? error)
  return c.json({ status: 500, message: 'Something went wrong. Please try again.' }, 500)
}
