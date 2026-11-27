import { categorizeRepository } from '../domain/categories'
import { daysBetween, percentileRanks } from '../domain/numbers'
import {
  periodDays,
  type GithubRepository,
  type PeriodRanking,
  type PeriodRepository,
  type RankedRepository,
  type RankingPeriod,
  type RepositorySnapshot
} from '../domain/repository'

// Week and month charts: the same candidates ranked by stars gained over 7 or 30 days. The
// score mixes absolute gain (60%) and gain relative to starting size (40%), the same blend the
// backtest uses to judge the daily ranking. They are separate lists and never change the daily
// scores or ranks.

const TOP = 50
// A baseline may be a little older or younger than the period when the exact day is missing.
const WINDOW = { min: 0.85, max: 1.3 }

interface PeriodOptions {
  now: string
  dataDate: string
  period: RankingPeriod
  snapshots: RepositorySnapshot[]
  /** Today's Top 50, for its categories and introductions. */
  ranked: RankedRepository[]
}

export function buildPeriodRanking(candidates: GithubRepository[], options: PeriodOptions): PeriodRanking {
  const length = periodDays[options.period]
  const baselines = options.snapshots
    .map((snapshot) => ({
      age: daysBetween(snapshot.capturedAt, options.now),
      stars: new Map(snapshot.repositories.map((entry) => [entry.id, entry.stars]))
    }))
    .filter(({ age }) => age >= length * WINDOW.min && age <= length * WINDOW.max)
    .sort((left, right) => Math.abs(left.age - length) - Math.abs(right.age - length))
  const today = new Map(options.ranked.map((repository) => [repository.id, repository]))

  const measured = candidates
    .filter((repository) => !repository.archived && !repository.fork)
    .flatMap((repository) => {
      const baseline = baselines.find(({ stars }) => stars.has(repository.id))
      const ageDays = Math.max(daysBetween(repository.createdAt, options.now), 1)
      let startStars: number
      let days: number
      if (baseline) {
        startStars = baseline.stars.get(repository.id)!
        days = baseline.age
      } else if (ageDays <= length * WINDOW.max) {
        // Created inside the period: every star was gained in it.
        startStars = 0
        days = ageDays
      } else {
        return []
      }
      const rawGain = Math.max(0, repository.stars - startStars)
      const gain = Math.round(days > length ? rawGain * length / days : rawGain)
      return gain > 0 ? [{ repository, gain, startStars, daysCovered: Math.min(days, length) }] : []
    })

  const absolute = percentileRanks(measured.map(({ gain }) => Math.log1p(gain)))
  const relative = percentileRanks(measured.map(({ gain, startStars }) => Math.log1p(gain / Math.sqrt(startStars + 25))))
  const repositories: PeriodRepository[] = measured
    .map((entry, index) => ({ ...entry, score: 0.6 * absolute[index] + 0.4 * relative[index] }))
    .sort((left, right) => right.score - left.score || right.gain - left.gain)
    .slice(0, TOP)
    .map(({ repository, gain, startStars, daysCovered }, index) => {
      const ranked = today.get(repository.id)
      const introduction = ranked?.research.introduction?.text
      return {
        rank: index + 1,
        id: repository.id,
        fullName: repository.fullName,
        owner: repository.owner,
        ownerAvatarUrl: repository.ownerAvatarUrl,
        url: repository.url,
        description: repository.description,
        language: repository.language,
        license: repository.license,
        topics: repository.topics,
        stars: repository.stars,
        forks: repository.forks,
        categories: ranked?.categories ?? categorizeRepository(repository),
        gain,
        daysCovered: Math.round(daysCovered * 10) / 10,
        startStars,
        todayRank: ranked?.rank ?? null,
        ...(introduction ? { introduction } : {})
      }
    })

  return {
    schemaVersion: 1,
    generatedAt: options.now,
    dataDate: options.dataDate,
    period: options.period,
    candidateCount: measured.length,
    repositories
  }
}
