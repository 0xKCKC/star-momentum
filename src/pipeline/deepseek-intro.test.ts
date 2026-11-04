// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { addDeepSeekIntroductions, cleanIntroduction, readmeExcerpt } from './deepseek-intro'
import { rankedRepository } from './test-repository'

const now = new Date('2026-11-04T08:00:00Z')
const intro = '這是一個用 Rust 重寫的桌面 IDE，提供熟悉的快捷鍵、除錯器和 Git 整合，適合想要更快編輯器的開發者。'

const readme = '# Tool\n![badge](x.svg)\nSee [docs](https://x).\n```sh\nrm -rf /\n```\nTool rebuilds the editor in Rust with a native window, a debugger, Git integration and a terminal.'

function fakeFetch(reply: (body: { messages: Array<{ content: string }> }) => Response) {
  const requests: Array<{ url: string, body?: string, auth?: string }> = []
  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input)
    const headers = (init?.headers ?? {}) as Record<string, string>
    requests.push({ url, body: init?.body as string | undefined, auth: headers.Authorization })
    if (url.endsWith('/readme')) return new Response(readme, { status: 200 })
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
    expect(cleanIntroduction('RUN · 润」是一本海外移居手冊，整理歐洲 36 國的最新移居路線和文件清單。'))
      .toBe('RUN · 润是一本海外移居手冊，整理歐洲 36 國的最新移居路線和文件清單。')
    expect(cleanIntroduction('「RUN」是一本海外移居手冊，整理歐洲 36 國的最新移居路線和文件清單。'))
      .toBe('RUN是一本海外移居手冊，整理歐洲 36 國的最新移居路線和文件清單。')
  })
})

describe('addDeepSeekIntroductions', () => {
  it('introduces the top 20 only, from the description and README', async () => {
    const { fetchImpl, requests } = fakeFetch(() => ok(intro))
    const repositories = Array.from({ length: 22 }, (_, index) => rankedRepository(index + 1, `Tool ${index + 1}`))
    const result = await addDeepSeekIntroductions(repositories, { apiKey: 'key', now, fetchImpl })

    expect(result[0].research.introduction).toEqual({ text: intro, writtenAt: now.toISOString(), source: 'deepseek', version: 3 })
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
      research: { ...rankedRepository(1, description).research, introduction: { text: '舊介紹舊介紹舊介紹舊介紹舊介紹舊介紹舊介紹', writtenAt, source: 'deepseek' as const, version: 3 } }
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

  it('asks once more when the first reply is too long', async () => {
    let calls = 0
    const { fetchImpl } = fakeFetch(() => ok(calls++ === 0 ? '長'.repeat(400) : intro))
    const [result] = await addDeepSeekIntroductions([rankedRepository(1, 'Tool')], { apiKey: 'key', now, fetchImpl })
    expect(result.research.introduction?.text).toBe(intro)
    expect(calls).toBe(2)
  })

  it('asks again with a bigger budget when the reply is empty', async () => {
    const budgets: number[] = []
    const { fetchImpl } = fakeFetch((body) => {
      const request = body as unknown as { max_tokens: number, messages: unknown[] }
      budgets.push(request.max_tokens)
      expect(request.messages).toHaveLength(2)
      return budgets.length === 1
        ? new Response(JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }), { status: 200 })
        : ok(intro)
    })
    const [result] = await addDeepSeekIntroductions([rankedRepository(1, 'Tool')], { apiKey: 'key', now, fetchImpl })
    expect(result.research.introduction?.text).toBe(intro)
    expect(budgets[1]).toBeGreaterThan(budgets[0])
  })

  it('writes nothing when the README cannot be read', async () => {
    let deepseekCalls = 0
    const fetchImpl = (async (input: URL | RequestInfo) => {
      if (String(input).endsWith('/readme')) return new Response('Not Found', { status: 404 })
      deepseekCalls += 1
      return ok(intro)
    }) as typeof fetch
    const [result] = await addDeepSeekIntroductions([rankedRepository(1, '一個中文描述的工具')], { apiKey: 'key', now, fetchImpl })
    expect(result.research.introduction).toBeUndefined()
    expect(deepseekCalls).toBe(0)
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
