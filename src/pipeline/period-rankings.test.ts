// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { GithubRepository, RepositorySnapshot } from '../domain/repository'
import { buildPeriodRanking } from './period-rankings'
import { rankedRepository } from './test-repository'

const now = '2026-11-27T00:00:00Z'

function candidate(id: number, stars: number, createdAt = '2026-01-01T00:00:00Z'): GithubRepository {
  const { rank, previousRank, rankChange, score, categories, signals, scoreBreakdown, research, ...repository } = rankedRepository(id, 'desc')
  return { ...repository, stars, createdAt }
}

function snapshot(capturedAt: string, stars: Record<number, number>): RepositorySnapshot {
  return {
    capturedAt,
    repositories: Object.entries(stars).map(([id, count]) => ({
      id: Number(id), fullName: `owner/repo${id}`, stars: count, forks: 0, openIssues: 0, pushedAt: capturedAt
    }))
  }
}

describe('buildPeriodRanking', () => {
  const snapshots = [
    snapshot('2026-11-26T00:00:00Z', { 1: 990, 2: 49_000, 3: 100 }),
    snapshot('2026-11-20T00:00:00Z', { 1: 300, 2: 48_000 }),
    snapshot('2026-11-19T00:00:00Z', { 3: 80 })
  ]

  it('ranks by absolute gain blended with gain relative to starting size', () => {
    const ranking = buildPeriodRanking(
      [candidate(1, 1000), candidate(2, 49_050), candidate(3, 120)],
      { now, dataDate: '2026-11-27', period: 'week', snapshots, ranked: [] }
    )

    // Repo 2 gained most (1050); repo 1 gained 700 from a far smaller base and stays close behind.
    expect(ranking.repositories.map(({ id }) => id)).toEqual([2, 1, 3])
    expect(ranking.repositories[1]).toMatchObject({ rank: 2, gain: 700, startStars: 300, daysCovered: 7, todayRank: null })
    // Baseline is 8 days old, so the 40-star gain is scaled to 7 days.
    expect(ranking.repositories[2]).toMatchObject({ gain: 35, startStars: 80 })
  })

  it('counts every star of a repository created inside the period and skips ones without a baseline', () => {
    const ranking = buildPeriodRanking(
      [candidate(8, 600, '2026-11-24T00:00:00Z'), candidate(9, 5000)],
      { now, dataDate: '2026-11-27', period: 'week', snapshots, ranked: [] }
    )

    expect(ranking.repositories).toHaveLength(1)
    expect(ranking.repositories[0]).toMatchObject({ id: 8, gain: 600, startStars: 0, daysCovered: 3 })
  })

  it('reuses today\'s rank, categories and introduction', () => {
    const ranked = rankedRepository(1, 'desc', ['ai'])
    ranked.rank = 4
    ranked.research.introduction = { text: '中文介紹', writtenAt: now, source: 'deepseek' }

    const ranking = buildPeriodRanking([candidate(1, 1000)], { now, dataDate: '2026-11-27', period: 'week', snapshots, ranked: [ranked] })

    expect(ranking.repositories[0]).toMatchObject({ todayRank: 4, categories: ['ai'], introduction: '中文介紹' })
  })
})
