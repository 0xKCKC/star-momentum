// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { addDeepSeekIntroductions, cleanIntroduction, readmeExcerpt } from './deepseek-intro'
import { rankedRepository } from './test-repository'

const now = new Date('2026-11-04T08:00:00Z')
const intro = '這是一個用 Rust 重寫的桌面 IDE，提供熟悉的快捷鍵、除錯器和 Git 整合，適合想要更快編輯器的開發者。'

function fakeFetch(reply: (body: { messages: Array<{ content: string }> }) => Response) {
  const requests: Array<{ url: string, body?: string, auth?: string }> = []
  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input)
    const headers = (init?.headers ?? {}) as Record<string, string>
    requests.push({ url, body: init?.body as string | undefined, auth: headers.Authorization })
    if (url.endsWith('/readme')) return new Response('# Tool\n![badge](x.svg)\nSee [docs](https://x).\n```sh\nrm -rf /\n```', { status: 200 })
    return reply(JSON.parse(String(init?.body)))
  }) as typeof fetch
  return { fetchImpl, requests }
}

const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })

describe('readmeExcerpt', () => {
  it('keeps the prose and drops images, link targets and code', () => {
    expect(readmeExcerpt('# Tool\n![badge](x.svg)\nSee [docs](https://x).\n```sh\nrm -rf /\n```')).toBe('# Tool\nSee docs.')
  })
})

describe('cleanIntroduction', () => {
  it('strips quotes and rejects text that is not a usable Chinese introduction', () => {
    expect(cleanIntroduction(`「${intro}」`)).toBe(intro)
    expect(cleanIntroduction('A fast IDE written in Rust for everyone who codes.')).toBeNull()
    expect(cleanIntroduction('太短')).toBeNull()
  })
})

describe('addDeepSeekIntroductions', () => {
  it('introduces the top 20 only, from the description and README', async () => {
    const { fetchImpl, requests } = fakeFetch(() => ok(intro))
    const repositories = Array.from({ length: 22 }, (_, index) => rankedRepository(index + 1, `Tool ${index + 1}`))
    const result = await addDeepSeekIntroductions(repositories, { apiKey: 'key', now, fetchImpl })

    expect(result[0].research.introduction).toEqual({ text: intro, writtenAt: now.toISOString(), source: 'deepseek' })
    expect(result[19].research.introduction).toBeDefined()
    expect(result[20].research.introduction).toBeUndefined()
    const call = requests.find(({ url }) => url.includes('deepseek'))!
    expect(call.auth).toBe('Bearer key')
    expect(call.body).toContain('Tool 1')
    expect(call.body).toContain('See docs.')
  })

  it('reuses a recent introduction while the description is unchanged', async () => {
    const { fetchImpl, requests } = fakeFetch(() => ok(intro))
    const earlier = (description: string, writtenAt: string) => ({
      ...rankedRepository(1, description),
      research: { ...rankedRepository(1, description).research, introduction: { text: '舊介紹舊介紹舊介紹舊介紹舊介紹舊介紹舊介紹', writtenAt, source: 'deepseek' as const } }
    })
    const [kept] = await addDeepSeekIntroductions([rankedRepository(1, 'Same')], {
      apiKey: 'key', now, fetchImpl, previous: [earlier('Same', '2026-11-03T08:00:00Z')]
    })
    expect(kept.research.introduction?.text).toContain('舊介紹')
    expect(requests).toHaveLength(0)

    const [rewritten] = await addDeepSeekIntroductions([rankedRepository(1, 'Changed')], {
      apiKey: 'key', now, fetchImpl, previous: [earlier('Same', '2026-11-03T08:00:00Z')]
    })
    expect(rewritten.research.introduction?.text).toBe(intro)
  })

  it('skips without a key and survives API failures', async () => {
    const input = [rankedRepository(1, 'Tool')]
    expect(await addDeepSeekIntroductions(input, { now })).toBe(input)

    const { fetchImpl } = fakeFetch(() => new Response('busy', { status: 503 }))
    const logs: string[] = []
    const [result] = await addDeepSeekIntroductions(input, { apiKey: 'key', now, fetchImpl, log: (message) => logs.push(message) })
    expect(result.research.introduction).toBeUndefined()
    expect(logs.join('\n')).toContain('1 failed')
  })
})
