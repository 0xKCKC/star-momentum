// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { cleanTrend, trendInput, writeTrendSummary } from './trend-summary'
import { rankedRepository } from './test-repository'

const now = new Date('2026-11-06T08:00:00Z')
const summary = '今日榜單有多個項目圍繞 DeepSeek Harness 生態，例如 DS-Bot 和 dsh-Go 等插件與客戶端；另有數個工具讓 Switch 遊戲在 Apple 裝置原生運行，如 NX2Apple。'

const repositories = Array.from({ length: 22 }, (_, index) => ({
  ...rankedRepository(index + 1, `Tool ${index + 1}`),
  research: {
    ...rankedRepository(index + 1, '').research,
    ...(index === 0 ? { introduction: { text: '第一個工具的中文介紹。', writtenAt: '', source: 'deepseek' as const } } : {})
  }
}))

function fakeFetch(reply: (call: number) => Response) {
  const bodies: Array<{ max_tokens: number, messages: Array<{ content: string }> }> = []
  const fetchImpl = (async (_input: URL | RequestInfo, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)))
    return reply(bodies.length)
  }) as typeof fetch
  return { fetchImpl, bodies }
}
const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }), { status: 200 })

describe('trendInput', () => {
  it('lists the top 20 with the introduction when there is one', () => {
    const input = trendInput(repositories)
    expect(input.split('\n')).toHaveLength(20)
    expect(input).toContain('#1 owner/repo1')
    expect(input).toContain('第一個工具的中文介紹。')
    expect(input).toContain('24 小時 +10 stars')
    expect(input).toContain('Tool 2')
  })
})

describe('cleanTrend', () => {
  it('drops a heading and rejects unusable text', () => {
    expect(cleanTrend(`今日趨勢：${summary}`)).toBe(summary)
    expect(cleanTrend('Too short')).toBeNull()
    expect(cleanTrend('長'.repeat(400))).toBeNull()
  })
})

describe('writeTrendSummary', () => {
  it('writes one summary for the day', async () => {
    const { fetchImpl, bodies } = fakeFetch(() => ok(summary))
    const result = await writeTrendSummary(repositories, { apiKey: 'key', now, fetchImpl })
    expect(result).toEqual({ text: summary, writtenAt: now.toISOString(), source: 'deepseek' })
    expect(bodies).toHaveLength(1)
  })

  it('retries an empty reply with a bigger budget and gives up quietly on failure', async () => {
    const { fetchImpl, bodies } = fakeFetch((call) => call === 1 ? ok('') : ok(summary))
    expect((await writeTrendSummary(repositories, { apiKey: 'key', now, fetchImpl }))?.text).toBe(summary)
    expect(bodies[1].max_tokens).toBeGreaterThan(bodies[0].max_tokens)

    const failing = fakeFetch(() => new Response('busy', { status: 503 }))
    const logs: string[] = []
    expect(await writeTrendSummary(repositories, { apiKey: 'key', now, fetchImpl: failing.fetchImpl, log: (m) => logs.push(m) })).toBeUndefined()
    expect(logs.join('\n')).toContain('Trend summary failed')
    expect(await writeTrendSummary(repositories, { now })).toBeUndefined()
  })
})
