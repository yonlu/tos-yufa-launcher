import type { CommunityCounts } from '@yufa/shared'

/**
 * The Discord counts behind the community card, read from the invite's public metadata
 * (`GET /invites/<code>?with_counts=true`): no bot, no token, one request per call. Any failure, a slow
 * network, a non-200, a body that is not the expected shape, answers null; the card then omits the numbers.
 */
export async function fetchDiscordCounts(
  inviteCode: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 5000,
): Promise<CommunityCounts | null> {
  try {
    const res = await fetchImpl(`https://discord.com/api/v10/invites/${encodeURIComponent(inviteCode)}?with_counts=true`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    const body: unknown = await res.json()
    if (typeof body !== 'object' || body === null) return null
    const { approximate_presence_count: online, approximate_member_count: members } = body as Record<string, unknown>
    if (typeof online !== 'number' || typeof members !== 'number') return null
    return { online, members }
  } catch {
    return null
  }
}
