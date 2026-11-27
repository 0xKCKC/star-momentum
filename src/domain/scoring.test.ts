import { describe, expect, it } from 'vitest'
import { scoreRepositories } from './scoring'
import type { GithubRepository, RepositorySnapshot } from './repository'

function repository(overrides: Partial<GithubRepository> & Pick<GithubRepository, 'id' | 'fullName'>): GithubRepository {
  const { id, fullName, ...rest } = overrides
  const [owner, name] = fullName.split('/')
  return {
    id,
    nodeId: `node-${id}`,
    name,
    fullName,
    owner,
    ownerAvatarUrl: '',
    url: `https://github.com/${overrides.fullName}`,
    description: 'A test repository',
    language: 'TypeScript',
    topics: [],
    stars: 100,
    forks: 10,
    openIssues: 2,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-09-02T00:00:00Z',
    pushedAt: '2026-09-02T00:00:00Z',
    license: 'MIT',
    archived: false,
    fork: false,
    ...rest
  }
}

function snapshotEntry(id: number, fullName: string, stars: number): RepositorySnapshot['repositories'][number] {
  return { id, fullName, stars, forks: 10, openIssues: 2, pushedAt: '2026-09-01T00:00:00Z' }
}

describe('scoreRepositories', () => {
  it('uses daily growth once a baseline exists', () => {
    const repositories = [
      repository({ id: 1, fullName: 'fast/rising', stars: 160 }),
      repository({ id: 2, fullName: 'large/steady', stars: 10_010 })
    ]
    const history: RepositorySnapshot[] = [{
      capturedAt: '2026-09-01T00:00:00Z',
      repositories: [
        { id: 1, fullName: 'fast/rising', stars: 100, forks: 5, openIssues: 2, pushedAt: '2026-09-01T00:00:00Z' },
        { id: 2, fullName: 'large/steady', stars: 10_000, forks: 500, openIssues: 20, pushedAt: '2026-09-01T00:00:00Z' }
      ]
    }]

    const result = scoreRepositories(repositories, {
      now: '2026-09-02T00:00:00Z',
      history
    })

    expect(result[0].fullName).toBe('fast/rising')
    expect(result[0].signals.stars24h).toBe(60)
    expect(result[1].signals.stars24h).toBe(10)
  })

  it('scores tied repositories identically regardless of input order', () => {
    const repositories = [
      repository({ id: 1, fullName: 'flat/one', stars: 100 }),
      repository({ id: 2, fullName: 'flat/two', stars: 100 }),
      repository({ id: 3, fullName: 'up/three', stars: 150 })
    ]
    const history: RepositorySnapshot[] = [{
      capturedAt: '2026-09-01T00:00:00Z',
      repositories: repositories.map(({ id, fullName }) => ({
        id, fullName, stars: 100, forks: 10, openIssues: 2, pushedAt: '2026-09-01T00:00:00Z'
      }))
    }]
    const scores = (input: GithubRepository[]) => new Map(
      scoreRepositories(input, { now: '2026-09-02T00:00:00Z', history }).map(({ id, score }) => [id, score])
    )

    const forward = scores(repositories)
    const reversed = scores([...repositories].reverse())

    expect(forward.get(1)).toBe(forward.get(2))
    expect(reversed).toEqual(forward)
  })

  it('normalizes growth to a daily rate and bridges a missed snapshot', () => {
    const result = scoreRepositories([
      repository({ id: 1, fullName: 'gap/repo', stars: 400 }),
      repository({ id: 2, fullName: 'other/repo', stars: 100 })
    ], {
      now: '2026-09-04T00:00:00Z',
      history: [
        { capturedAt: '2026-09-03T00:00:00Z', repositories: [snapshotEntry(2, 'other/repo', 100)] },
        { capturedAt: '2026-09-02T00:00:00Z', repositories: [snapshotEntry(1, 'gap/repo', 200)] }
      ]
    })

    expect(result.find(({ id }) => id === 1)?.signals.stars24h).toBe(100)
  })

  it('blends the daily rate with the three-day rate', () => {
    const [result] = scoreRepositories([repository({ id: 1, fullName: 'steady/repo', stars: 190 })], {
      now: '2026-09-04T00:00:00Z',
      history: [
        { capturedAt: '2026-09-03T00:00:00Z', repositories: [snapshotEntry(1, 'steady/repo', 100)] },
        { capturedAt: '2026-09-01T00:00:00Z', repositories: [snapshotEntry(1, 'steady/repo', 70)] }
      ]
    })

    expect(result.signals.stars24h).toBe(90)
    expect(result.signals.starVelocity).toBe(65)
  })

  it('counts every star of a repository created after the latest baseline', () => {
    const [result] = scoreRepositories([
      repository({ id: 1, fullName: 'brand/new', stars: 300, createdAt: '2026-09-03T12:00:00Z' })
    ], {
      now: '2026-09-04T00:00:00Z',
      history: [{ capturedAt: '2026-09-03T00:00:00Z', repositories: [] }]
    })

    expect(result.signals.stars24h).toBe(300)
  })

  it('gives repositories without a baseline an above-median velocity instead of zero', () => {
    const gains = [1, 5, 20, 50, 100]
    const history: RepositorySnapshot[] = [{
      capturedAt: '2026-09-01T00:00:00Z',
      repositories: gains.map((_, index) => snapshotEntry(index + 1, `known/repo-${index + 1}`, 100))
    }]
    const result = scoreRepositories([
      ...gains.map((gain, index) => repository({ id: index + 1, fullName: `known/repo-${index + 1}`, stars: 100 + gain })),
      repository({ id: 9, fullName: 'unseen/repo', stars: 100 })
    ], { now: '2026-09-02T00:00:00Z', history })
    const momentum = (id: number) => result.find((entry) => entry.id === id)!.scoreBreakdown.starMomentum

    expect(result.find(({ id }) => id === 9)?.signals.stars24h).toBeNull()
    expect(momentum(9)).toBe(momentum(4))
    expect(momentum(9)).toBeGreaterThan(momentum(3))
  })

  it('reports the fork share of new stars over a week', () => {
    const [result] = scoreRepositories([
      repository({ id: 1, fullName: 'starry/repo', stars: 1300, forks: 15 })
    ], {
      now: '2026-09-08T00:00:00Z',
      history: [
        { capturedAt: '2026-09-07T00:00:00Z', repositories: [{ ...snapshotEntry(1, 'starry/repo', 1200), forks: 14 }] },
        { capturedAt: '2026-09-01T00:00:00Z', repositories: [{ ...snapshotEntry(1, 'starry/repo', 300), forks: 10 }] }
      ]
    })

    expect(result.signals.forkRatio7d).toBeCloseTo(0.005)
    expect(result.research.cautions.some((caution) => caution.includes('刷星'))).toBe(true)
  })

  it('uses the stars GitHub Trending reports when a repository has no baseline', () => {
    const history: RepositorySnapshot[] = [{
      capturedAt: '2026-09-01T00:00:00Z',
      repositories: [snapshotEntry(1, 'known/repo', 100)]
    }]
    const result = scoreRepositories([
      repository({ id: 1, fullName: 'known/repo', stars: 150 }),
      repository({ id: 2, fullName: 'surging/repo', stars: 40_000 })
    ], { now: '2026-09-02T00:00:00Z', history, dailyGainHints: new Map([[1, 9999], [2, 800]]) })

    // A real baseline wins over the hint; the hint replaces imputation.
    expect(result.find(({ id }) => id === 1)?.signals.stars24h).toBe(50)
    expect(result.find(({ id }) => id === 2)?.signals.stars24h).toBe(800)
  })

  it('excludes archived repositories and forks', () => {
    const result = scoreRepositories([
      repository({ id: 1, fullName: 'active/repo' }),
      repository({ id: 2, fullName: 'old/repo', archived: true }),
      repository({ id: 3, fullName: 'copy/repo', fork: true })
    ], { now: '2026-09-02T00:00:00Z' })

    expect(result.map(({ fullName }) => fullName)).toEqual(['active/repo'])
  })

  it('reports rank movement from the prior ranking', () => {
    const previousRanking = scoreRepositories([
      repository({ id: 1, fullName: 'one/repo', stars: 500 }),
      repository({ id: 2, fullName: 'two/repo', stars: 100 })
    ], { now: '2026-09-01T00:00:00Z' })
    const result = scoreRepositories([
      repository({ id: 1, fullName: 'one/repo', stars: 500 }),
      repository({ id: 2, fullName: 'two/repo', stars: 800, createdAt: '2026-08-30T00:00:00Z' })
    ], {
      now: '2026-09-02T00:00:00Z',
      previousRanking
    })

    expect(result.find(({ id }) => id === 2)?.rankChange).toBe(1)
  })
})
