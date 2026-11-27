// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { ChartHistory, RankedRepository } from '../domain/repository'
import { addGithubTrending, fetchTrendingNames, parseTrending } from './github-trending'
import { rankedRepository } from './test-repository'

const now = new Date('2026-11-27T00:00:00Z')

function row(fullName: string): string {
  return `<article class="Box-row"><h2 class="h3 lh-condensed">
    <a data-hydro-click="{}" href="/${fullName}" class="Link">
      <span class="text-normal">${fullName.split('/')[0]} /</span> ${fullName.split('/')[1]}</a></h2>
    <a href="/${fullName}/stargazers">1,234</a></article>`
}

function page(...names: string[]): Response {
  return new Response(`<html><h2 class="title">Trending</h2>${names.map(row).join('')}</html>`, { status: 200 })
}

function charted(id: number, firstSeen: string): RankedRepository {
  const repository = rankedRepository(id, '')
  const chart: ChartHistory = { firstSeen, days: 1, streak: 1, bestRank: id }
  return { ...repository, research: { ...repository.research, chart } }
}

const fillers = ['a/one', 'b/two', 'c/three', 'd/four']

describe('parseTrending', () => {
  it('reads repository names from the list and ignores other links', () => {
    expect(parseTrending(`${row('Owner/Repo1')}${row('x/y.js')}`)).toEqual(['owner/repo1', 'x/y.js'])
  })
})

describe('fetchTrendingNames', () => {
  it('reads the daily and weekly pages', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).endsWith('weekly') ? page('w/one', ...fillers) : page('owner/repo1', ...fillers))

    const names = await fetchTrendingNames({ fetchImpl })

    expect(names?.daily.has('owner/repo1')).toBe(true)
    expect(names?.weekly.has('w/one')).toBe(true)
  })

  it('returns null when the daily page fails or its markup changes', async () => {
    expect(await fetchTrendingNames({ fetchImpl: vi.fn(async () => new Response('', { status: 429 })) })).toBeNull()
    expect(await fetchTrendingNames({ fetchImpl: vi.fn(async () => page('only/one')) })).toBeNull()
  })
})

describe('addGithubTrending', () => {
  it('marks listed and unlisted repositories without claiming a lead on the first tracked day', () => {
    const { repositories, comparison } = addGithubTrending(
      [charted(1, '2026-11-20'), charted(2, '2026-11-27')],
      { now, today: '2026-11-27', days: [], listed: new Set(['owner/repo1', ...fillers]) }
    )

    expect(repositories[0].research.githubTrending).toEqual({ listed: true, firstListed: '2026-11-27', leadDays: null })
    expect(repositories[1].research.githubTrending).toEqual({ listed: false, firstListed: null, leadDays: null })
    expect(comparison).toEqual({ checkedAt: now.toISOString(), trackedSince: '2026-11-27', size: 5, unlisted: 1 })
  })

  it('reports how many days this ranking was ahead once tracking has history', () => {
    const days = [{
      date: '2026-11-25',
      repositories: [{ id: 2, rank: 1, research: { githubTrending: { listed: true, firstListed: '2026-11-25', leadDays: null } } }],
      githubTrending: { checkedAt: '', trackedSince: '2026-11-24', size: 25, unlisted: 30 }
    }]

    const { repositories, comparison } = addGithubTrending(
      [charted(1, '2026-11-25'), charted(2, '2026-11-25'), charted(3, '2026-11-01')],
      { now, today: '2026-11-27', days, listed: new Set(['owner/repo1', 'owner/repo2', ...fillers]) }
    )

    expect(repositories[0].research.githubTrending).toEqual({ listed: true, firstListed: '2026-11-27', leadDays: 2 })
    expect(repositories[1].research.githubTrending).toEqual({ listed: true, firstListed: '2026-11-25', leadDays: null })
    expect(repositories[2].research.githubTrending?.listed).toBe(false)
    expect(comparison.trackedSince).toBe('2026-11-24')
    expect(repositories[0].research.evidence).toContain('GitHub Trending 日榜：本榜早 2 日收錄')
  })
})
