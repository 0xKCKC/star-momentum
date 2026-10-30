import type { RankedRepository } from '../domain/repository'

export function rankedRepository(id: number, description: string, categories: RankedRepository['categories'] = ['other']): RankedRepository {
  return {
    id,
    nodeId: `node-${id}`,
    name: `repo${id}`,
    fullName: `owner/repo${id}`,
    owner: 'owner',
    ownerAvatarUrl: '',
    url: `https://github.com/owner/repo${id}`,
    description,
    language: 'Python',
    topics: [],
    stars: 100,
    forks: 10,
    openIssues: 1,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    pushedAt: '2026-10-01T00:00:00Z',
    license: 'MIT',
    archived: false,
    fork: false,
    rank: id,
    previousRank: null,
    rankChange: null,
    score: 50,
    categories,
    signals: {
      stars24h: 10,
      forks24h: 1,
      relativeGrowth: 1,
      acceleration7d: null,
      ageDays: 30,
      hoursSincePush: 5,
      starsPerDay: 3
    },
    scoreBreakdown: { starMomentum: 1, relativeGrowth: 1, acceleration: 1, forkMomentum: 1, developmentActivity: 1, freshness: 1 },
    research: { summary: '', whyNow: '', bestFor: '', evidence: [], cautions: [] }
  }
}
