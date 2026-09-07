import { describe, expect, it } from 'vitest'
import { fetchDiscordCounts } from '../src/main/community'

type FetchImpl = typeof fetch

/** A fetch stand-in that answers every request the same way and records the URL and signal it saw. */
function fakeFetch(answer: (init?: RequestInit) => Promise<Response>): FetchImpl & { calls: { url: string; init?: RequestInit }[] } {
  const calls: { url: string; init?: RequestInit }[] = []
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    return answer(init)
  }) as FetchImpl & { calls: typeof calls }
  impl.calls = calls
  return impl
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('fetchDiscordCounts', () => {
  it('asks the invite endpoint with counts and maps the two approximate fields', async () => {
    const fetchImpl = fakeFetch(async () => json({ approximate_presence_count: 42, approximate_member_count: 1234 }))
    await expect(fetchDiscordCounts('abc123', fetchImpl)).resolves.toEqual({ online: 42, members: 1234 })
    expect(fetchImpl.calls).toHaveLength(1)
    expect(fetchImpl.calls[0]!.url).toBe('https://discord.com/api/v10/invites/abc123?with_counts=true')
    expect(fetchImpl.calls[0]!.init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('yields null when the request outlives the timeout', async () => {
    const fetchImpl = fakeFetch(
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
        }),
    )
    await expect(fetchDiscordCounts('abc123', fetchImpl, 20)).resolves.toBeNull()
  })

  it('yields null on a non-200 answer', async () => {
    const fetchImpl = fakeFetch(async () => json({ message: 'Unknown Invite', code: 10006 }, 404))
    await expect(fetchDiscordCounts('abc123', fetchImpl)).resolves.toBeNull()
  })

  it('yields null when the body is not JSON', async () => {
    const fetchImpl = fakeFetch(async () => new Response('<html>rate limited</html>', { status: 200 }))
    await expect(fetchDiscordCounts('abc123', fetchImpl)).resolves.toBeNull()
  })

  it('yields null when the counts are missing or not numbers', async () => {
    const missing = fakeFetch(async () => json({ code: 'abc123', guild: {} }))
    await expect(fetchDiscordCounts('abc123', missing)).resolves.toBeNull()
    const strings = fakeFetch(async () => json({ approximate_presence_count: '42', approximate_member_count: '1234' }))
    await expect(fetchDiscordCounts('abc123', strings)).resolves.toBeNull()
  })

  it('yields null when fetch itself rejects (offline)', async () => {
    const fetchImpl = fakeFetch(async () => {
      throw new TypeError('fetch failed')
    })
    await expect(fetchDiscordCounts('abc123', fetchImpl)).resolves.toBeNull()
  })
})
