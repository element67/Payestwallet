/** The frontend must never show a bare "Request failed (401)". Run: bun run test:errors */
import { describe, expect, test } from 'bun:test'

Object.assign(globalThis, { sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} } })
const { api, ApiClientError } = await import('../src/lib/api')

const respond = (status: number, body: string, type = 'text/html') => {
  globalThis.fetch = (() => Promise.resolve(new Response(body, { status, headers: { 'content-type': type } }))) as typeof fetch
}
const failure = async (): Promise<InstanceType<typeof ApiClientError>> => {
  try {
    await api.register({ email: 'a@b.co', password: 'x', displayName: 'x' })
  } catch (e) {
    return e as InstanceType<typeof ApiClientError>
  }
  throw new Error('expected a failure')
}

describe('readable API errors', () => {
  test('a host login wall (HTML 401) is explained, not shown as a bare status', async () => {
    respond(401, '<html>Login Redirect</html>')
    const e = await failure()
    expect(e.code).toBe('NOT_API')
    expect(e.message).toContain('blocked this request')
    expect(e.message).not.toBe('Request failed (401).')
  })
  test('a 200 HTML page from a SPA rewrite is not mistaken for the API', async () => {
    respond(200, '<html>index</html>')
    const e = await failure()
    expect(e.code).toBe('NOT_API')
    expect(e.message).toContain('No Payest API was found')
  })
  test('a proxy 502 and a 404 get their own messages', async () => {
    respond(502, 'Bad Gateway')
    expect((await failure()).message).toContain('having a problem')
    respond(404, 'nope')
    expect((await failure()).message).toContain('No Payest API was found')
  })
  test('the API own JSON errors pass through untouched', async () => {
    respond(409, JSON.stringify({ error: { code: 'EMAIL_TAKEN', message: 'An account with this email already exists. Try signing in.' } }), 'application/json')
    const e = await failure()
    expect(e.code).toBe('EMAIL_TAKEN')
    expect(e.message).toBe('An account with this email already exists. Try signing in.')
  })
})
