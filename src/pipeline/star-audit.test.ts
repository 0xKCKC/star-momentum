// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { auditStargazers, auditTopStargazers, creationEstimator, type GetJson, type Stargazer } from './star-audit'
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

// A fake GitHub REST API. Account ids grow with creation time: id 1000 + n was created n days
// after 2016-01-01, so ids from 4940 are accounts created from mid-October 2026.
const EPOCH = Date.parse('2016-01-01T00:00:00Z')
const created = (id: number) => new Date(EPOCH + (id - 1000) * 86_400_000).toISOString()

interface FakeUser { login: string, id: number, hollow?: boolean }

function fakeApi(stargazers: Record<string, FakeUser[]>) {
  const calls: string[] = []
  const users = new Map(Object.values(stargazers).flat().map((user) => [user.login, user]))
  const getJson: GetJson = async (path) => {
    calls.push(path)
    const list = path.match(/^\/repos\/(.+)\/stargazers\?per_page=100&page=(\d+)$/)
    if (list) {
      const all = stargazers[list[1]] ?? []
      return all.slice((Number(list[2]) - 1) * 100, Number(list[2]) * 100)
        .map((user) => ({ starred_at: '2026-10-29T12:00:00Z', user: { login: user.login, id: user.id } }))
    }
    const user = users.get(path.replace('/users/', ''))
    if (!user) return null
    return {
      login: user.login,
      created_at: created(user.id),
      public_repos: user.hollow ? 1 : 30,
      followers: user.hollow ? 0 : 40,
      bio: user.hollow ? null : 'Building things',
      company: null,
      location: null,
      blog: null
    }
  }
  return { getJson, calls }
}

const oldUsers = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => ({ login: `${prefix}${index}`, id: 1000 + index * 10 }))
const newHollowUsers = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, index) => ({ login: `${prefix}${index}`, id: 4940 + index, hollow: true }))

describe('creationEstimator', () => {
  it('interpolates between known accounts and clamps outside them', () => {
    const estimate = creationEstimator([{ id: 100, createdAt: 1000 }, { id: 300, createdAt: 3000 }])
    expect(estimate(200)).toBe(2000)
    expect(estimate(50)).toBe(1000)
    expect(estimate(400)).toBe(3000)
  })
})

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
    const inflated = { ...rankedRepository(1, 'Inflated tool'), stars: 150 }
    const clean = {
      ...rankedRepository(2, 'Clean tool'),
      stars: 100,
      research: {
        summary: '', whyNow: '', bestFor: '', evidence: [],
        cautions: ['近 7 日新增 forks 只有新增 stars 的 1.0%（一般約 10%），可能是收藏型清單，亦可能有刷星，宜先核實 stargazers。']
      }
    }
    const { getJson, calls } = fakeApi({
      'owner/repo1': [...oldUsers('early', 50), ...oldUsers('real', 60), ...newHollowUsers('fake', 40)],
      'owner/repo2': oldUsers('fan', 100)
    })
    const logs: string[] = []
    const [first, second] = await auditTopStargazers([inflated, clean], { getJson, log: (message) => logs.push(message) })

    // The 100 newest of 150 stargazers span pages 1 and 2.
    expect(calls).toContain('/repos/owner/repo1/stargazers?per_page=100&page=2')
    expect(calls).toContain('/repos/owner/repo1/stargazers?per_page=100&page=1')
    // Old accounts are judged from their id alone, without fetching their profiles.
    expect(calls.filter((path) => path.startsWith('/users/real')).length).toBeLessThanOrEqual(3)
    expect(first.research.risks).toEqual(['starInflation'])
    expect(first.research.cautions[0]).toContain('40 個（40%）')
    expect(first.rank).toBe(1)
    expect(second.research.risks).toBeUndefined()
    expect(second.research.cautions.some((caution) => caution.startsWith('近 7 日新增 forks'))).toBe(false)
    expect(second.research.cautions).toHaveLength(1)
    expect(logs.join('\n')).toContain('owner/repo1 sampled=100 suspicious=40')
  })

  it('counts hollow accounts that starred several of the Top 50 even when they are not new', async () => {
    const shared = Array.from({ length: 30 }, (_, index) => ({ login: `ring${index}`, id: 2000 + index, hollow: true }))
    const repositories = [1, 2, 3].map((id) => ({ ...rankedRepository(id, `Tool ${id}`), stars: 100 }))
    const { getJson } = fakeApi(Object.fromEntries(repositories.map(({ fullName }) =>
      [fullName, [...oldUsers(`${fullName}-fan`, 70), ...shared]])))
    const result = await auditTopStargazers(repositories, { getJson })

    expect(result.map(({ research }) => research.starAudit?.sharedHollow)).toEqual([30, 30, 30])
    expect(result.every(({ research }) => research.risks?.includes('starInflation'))).toBe(true)
  })

  it('leaves the ranking untouched when the API fails or there is no token', async () => {
    const input = [{ ...rankedRepository(1, 'Tool'), stars: 5000 }]
    const failing: GetJson = async () => { throw new Error('GitHub REST 502') }

    expect(await auditTopStargazers(input, { getJson: failing })).toBe(input)
    expect(await auditTopStargazers(input, {})).toBe(input)
  })
})
