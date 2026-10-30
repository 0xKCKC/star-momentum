// @vitest-environment node
import { TypeSafeClient } from '@typesafe-ai/sdk'
import { describe, expect, it } from 'vitest'
import { rankedRepository as ranked } from './test-repository'
import { categoriesFromAnswers, researchWithJev, risksFromAnswers } from './jev-research'

function clientReturning(answer: (body: Record<string, unknown>) => unknown, status = 200) {
  const requests: Array<{ url: string, body: Record<string, unknown>, auth: string | null }> = []
  const client = new TypeSafeClient({
    apiKey: 'test-key',
    logLevel: 'off',
    retry: { maxRetries: 0 },
    fetch: async (url, init) => {
      const body = JSON.parse(String(init?.body))
      requests.push({ url, body, auth: new Headers(init?.headers).get('authorization') })
      return new Response(JSON.stringify(answer(body)), { status, headers: { 'content-type': 'application/json' } })
    }
  })
  return { client, requests }
}

const categories = ['ai', 'devtools', 'web', 'data', 'infra', 'security', 'mobile', 'desktop', 'creative', 'games', 'learning']

const gameAnswer = {
  model: 'jev-1',
  usage: { input_tokens: 100, output_tokens: 1 },
  answers: {
    category: {
      type: 'choice',
      choice: 'games',
      confidence: 0.8,
      probabilities: { games: 0.6, creative: 0.3, other: 0.1 }
    },
    ...Object.fromEntries(categories.map((category) => [
      `also_${category}`,
      { type: 'noul', noul: category === 'games' ? 0.95 : category === 'desktop' ? 0.7 : 0.1 }
    ])),
    ...Object.fromEntries(['piracy', 'leaked', 'adult', 'crypto', 'serviceAbuse', 'misuse'].map((flag) => [
      `risk_${flag}`,
      { type: 'noul', noul: flag === 'leaked' ? 0.9 : flag === 'piracy' ? 0.65 : 0.02 }
    ]))
  }
}

describe('risksFromAnswers', () => {
  it('keeps only risks Jev judged likely', () => {
    expect(risksFromAnswers({ piracy: 0.92, leaked: 0.4, adult: 0.7 })).toEqual([
      { flag: 'piracy', yes: 0.92 },
      { flag: 'adult', yes: 0.7 }
    ])
  })
})

describe('categoriesFromAnswers', () => {
  it('adds the strongest other category that clearly also applies', () => {
    expect(categoriesFromAnswers('games', { games: 0.95, desktop: 0.7, creative: 0.65 })).toEqual(['games', 'desktop'])
  })

  it('keeps one category when nothing else clearly applies', () => {
    expect(categoriesFromAnswers('ai', { ai: 0.9, devtools: 0.5 })).toEqual(['ai'])
    expect(categoriesFromAnswers('other', { web: 0.9 })).toEqual(['other'])
  })

  it('rejects labels outside the category list', () => {
    expect(categoriesFromAnswers('hacking', {})).toBeNull()
  })
})

describe('researchWithJev', () => {
  it('sends repository state to the System One endpoint and applies the choice', async () => {
    const { client, requests } = clientReturning(() => gameAnswer)
    const [result] = await researchWithJev([ranked(1, 'Experimental Eden port for PS5')], { client })

    expect(requests[0].url).toBe('https://api.typesafe.ai/v1/systemone')
    expect(requests[0].auth).toBe('Bearer test-key')
    expect(requests[0].body.model).toBe('jev-latest')
    expect(requests[0].body.state).toMatchObject({ repository: { name: 'owner/repo1', description: 'Experimental Eden port for PS5' } })
    expect(requests[0].body.questions).toHaveProperty('category.type', 'choice')
    expect(requests[0].body.questions).toHaveProperty('also_desktop.type', 'noul')
    expect(Object.keys(requests[0].body.questions as object)).toHaveLength(18)
    expect(requests[0].body.questions).toHaveProperty('risk_piracy.type', 'noul')
    expect(result.categories).toEqual(['games', 'desktop'])
    expect(result.research.risks).toEqual(['leaked'])
    expect(result.research.cautions[0]).toContain('洩漏')
    expect(result.rank).toBe(1)
    expect(result.score).toBe(50)
    expect(result.research.categorySource).toBe('jev')
    expect(result.research.bestFor).toContain('遊戲')
  })

  it('does not ask about repositories with no description or topics', async () => {
    const { client, requests } = clientReturning(() => gameAnswer)
    const [result] = await researchWithJev([ranked(1, '  ')], { client })

    expect(requests).toHaveLength(0)
    expect(result.categories).toEqual(['other'])
  })

  it('keeps rule categories and stops when the key is rejected', async () => {
    const logs: string[] = []
    const { client, requests } = clientReturning(() => ({ error: 'invalid api key' }), 401)
    const input = Array.from({ length: 20 }, (_, index) => ranked(index + 1, 'An AI agent', ['ai']))
    const result = await researchWithJev(input, { client, log: (message) => logs.push(message) })

    expect(result.map(({ categories }) => categories)).toEqual(input.map(() => ['ai']))
    expect(requests.length).toBeLessThan(input.length)
    expect(logs.join('\n')).toContain('stopped')
  })

  it('skips without a key', async () => {
    const input = [ranked(1, 'A tool')]
    expect(await researchWithJev(input, {})).toBe(input)
  })
})
