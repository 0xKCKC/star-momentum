// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { auditStargazers, auditTopStargazers, type Stargazer, type StargazerEdge } from './star-audit'
import { rankedRepository } from './test-repository'

function stargazer(index: number, overrides: Partial<Stargazer> = {}): Stargazer {
  return {
    login: `user${index}`,
    starredAt: `2026-10-29T${String(10 + (index % 10)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}:00Z`,
    createdAt: '2018-01-01T00:00:00Z',
    hollow: false,
    ...overrides
  }
}

function edge(login: string, options: { fresh?: boolean, hollow?: boolean } = {}): StargazerEdge {
  return {
    starredAt: '2026-10-29T12:00:00Z',
    node: {
      login,
      createdAt: options.fresh ? '2026-10-28T00:00:00Z' : '2017-05-01T00:00:00Z',
      bio: options.hollow ? null : 'Building things',
      company: null,
      location: null,
      websiteUrl: null,
      followers: { totalCount: options.hollow ? 0 : 40 },
      repositories: { totalCount: options.hollow ? 1 : 30 }
    }
  }
}

describe('auditStargazers', () => {
  it('counts hollow accounts created shortly before they starred', () => {
    const sample = [
      ...Array.from({ length: 70 }, (_, index) => stargazer(index)),
      ...Array.from({ length: 30 }, (_, index) => stargazer(100 + index, { hollow: true, createdAt: '2026-10-25T00:00:00Z' }))
    ]
    const audit = auditStargazers(sample, new Set())

    expect(audit).toMatchObject({ sampled: 100, suspicious: 30, freshHollow: 30, flagged: true })
  })

  it('does not flag ordinary new users or established hollow accounts', () => {
    const sample = [
      ...Array.from({ length: 90 }, (_, index) => stargazer(index)),
      ...Array.from({ length: 5 }, (_, index) => stargazer(100 + index, { hollow: true, createdAt: '2026-10-20T00:00:00Z' })),
      ...Array.from({ length: 5 }, (_, index) => stargazer(200 + index, { hollow: true }))
    ]
    const audit = auditStargazers(sample, new Set())

    expect(audit.suspicious).toBe(5)
    expect(audit.flagged).toBe(false)
  })

  it('counts hollow accounts that starred several of the Top 50', () => {
    const sample = Array.from({ length: 40 }, (_, index) => stargazer(index, { hollow: true }))
    const shared = new Set(sample.slice(0, 20).map(({ login }) => login))

    expect(auditStargazers(sample, shared)).toMatchObject({ sharedHollow: 20, suspicious: 20, flagged: true })
  })

  it('reports the busiest minute', () => {
    const sample = Array.from({ length: 12 }, (_, index) => stargazer(index, { starredAt: '2026-10-29T12:00:30Z' }))
    expect(auditStargazers(sample, new Set()).maxPerMinute).toBe(12)
  })
})

describe('auditTopStargazers', () => {
  it('flags an inflated repository, keeps its rank, and drops the fork screen for a clean one', async () => {
    const inflated = { ...rankedRepository(1, 'Inflated tool'), stars: 5000 }
    const clean = {
      ...rankedRepository(2, 'Clean tool'),
      stars: 5000,
      research: {
        summary: '', whyNow: '', bestFor: '', evidence: [],
        cautions: ['近 7 日新增 forks 只有新增 stars 的 1.0%（一般約 10%），可能是收藏型清單，亦可能有刷星，宜先核實 stargazers。']
      }
    }
    const queries: string[] = []
    const request = async (query: string) => {
      queries.push(query)
      return {
        r0: { stargazers: { edges: [
          ...Array.from({ length: 60 }, (_, index) => edge(`real${index}`)),
          ...Array.from({ length: 40 }, (_, index) => edge(`fake${index}`, { fresh: true, hollow: true }))
        ] } },
        r1: { stargazers: { edges: Array.from({ length: 100 }, (_, index) => edge(`fan${index}`)) } }
      }
    }
    const logs: string[] = []
    const [first, second] = await auditTopStargazers([inflated, clean], { request, log: (message) => logs.push(message) })

    expect(queries[0]).toContain('orderBy: { field: STARRED_AT, direction: DESC }')
    expect(first.research.risks).toEqual(['starInflation'])
    expect(first.research.cautions[0]).toContain('40 個（40%）')
    expect(first.rank).toBe(1)
    expect(second.research.risks).toBeUndefined()
    expect(second.research.cautions.some((caution) => caution.startsWith('近 7 日新增 forks'))).toBe(false)
    expect(second.research.cautions).toHaveLength(1)
    expect(logs.join('\n')).toContain('owner/repo1 sampled=100 suspicious=40')
  })

  it('leaves the ranking untouched when the API fails or there is no token', async () => {
    const input = [{ ...rankedRepository(1, 'Tool'), stars: 5000 }]
    const failing = async () => { throw new Error('GitHub GraphQL 502') }

    expect(await auditTopStargazers(input, { request: failing })).toBe(input)
    expect(await auditTopStargazers(input, {})).toBe(input)
  })
})
