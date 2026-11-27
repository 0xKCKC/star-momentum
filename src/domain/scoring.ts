import { categorizeRepository } from './categories'
import { buildResearch } from './research'
import { clamp, daysBetween, hoursBetween, percentileRanks } from './numbers'
import type {
  GithubRepository,
  RankedRepository,
  RankingSignals,
  RepositorySnapshot,
  ScoreBreakdown
} from './repository'

interface ScoreRepositoriesOptions {
  now: string
  history?: RepositorySnapshot[]
  previousRanking?: RankedRepository[]
  /**
   * Stars gained today as reported by GitHub Trending, by repository id. Used only when a
   * repository has no snapshot baseline, instead of the imputed velocity.
   */
  dailyGainHints?: Map<number, number>
}

interface PreparedRepository {
  repository: GithubRepository
  signals: RankingSignals
}

type SnapshotEntry = RepositorySnapshot['repositories'][number]

interface IndexedSnapshot {
  ageDays: number
  entries: Map<number, SnapshotEntry>
}

// Baseline windows in days, chosen by backtesting against the stored snapshots.
const DAILY_WINDOW = { min: 0.4, max: 4 }
const SHORT_WINDOW = { min: 2.5, max: 4 }
const WEEK_WINDOW = { min: 6.5, max: 9 }
const SHORT_WINDOW_WEIGHT = 0.5
const NO_BASELINE_QUANTILE = 0.7
// Fork share of new stars is only reported once a repository gains this many stars in a week.
const FORK_RATIO_MIN_STARS = 200

interface DailyRate {
  value: number
  days: number
}

function indexHistory(history: RepositorySnapshot[], now: string): IndexedSnapshot[] {
  return [...history]
    .sort((left, right) => right.capturedAt.localeCompare(left.capturedAt))
    .map((snapshot) => ({
      ageDays: daysBetween(snapshot.capturedAt, now),
      entries: new Map(snapshot.repositories.map((entry) => [entry.id, entry]))
    }))
}

// Gain per day against the most recent snapshot inside the window that contains the repository,
// so a missed run or a repository that briefly left the candidate pool still has a baseline.
function dailyRate(
  history: IndexedSnapshot[],
  repository: GithubRepository,
  field: 'stars' | 'forks',
  window: { min: number, max: number }
): DailyRate | null {
  for (const snapshot of history) {
    if (snapshot.ageDays < window.min) continue
    if (snapshot.ageDays > window.max) break
    const entry = snapshot.entries.get(repository.id)
    if (entry) {
      return { value: Math.max(0, repository[field] - entry[field]) / snapshot.ageDays, days: snapshot.ageDays }
    }
  }
  return null
}

function buildSignals(
  repository: GithubRepository,
  now: string,
  history: IndexedSnapshot[],
  dailyGainHint?: number
): RankingSignals {
  const ageDays = Math.max(daysBetween(repository.createdAt, now), 0.25)
  const starsPerDay = repository.stars / ageDays
  let daily = dailyRate(history, repository, 'stars', DAILY_WINDOW)
  let forkDaily = dailyRate(history, repository, 'forks', DAILY_WINDOW)

  // A repository created after the latest baseline gained every star inside the window.
  const latestBaseline = history.find((snapshot) => snapshot.ageDays >= DAILY_WINDOW.min)
  if (!daily && latestBaseline && ageDays <= latestBaseline.ageDays) {
    const days = Math.max(ageDays, 1)
    daily = { value: repository.stars / days, days }
    forkDaily = { value: repository.forks / days, days }
  }
  // Just added to the pool from GitHub Trending: its page states the stars gained today.
  if (!daily && dailyGainHint !== undefined) {
    daily = { value: Math.max(0, dailyGainHint), days: 1 }
  }

  const shortTerm = daily ? dailyRate(history, repository, 'stars', SHORT_WINDOW) : null
  const week = daily ? dailyRate(history, repository, 'stars', WEEK_WINDOW) : null
  const starVelocity = daily
    ? shortTerm
      ? (1 - SHORT_WINDOW_WEIGHT) * daily.value + SHORT_WINDOW_WEIGHT * shortTerm.value
      : daily.value
    : null

  let acceleration7d: number | null = null
  if (daily && week && week.days > daily.days) {
    const earlierGain = Math.max(week.value * week.days - daily.value * daily.days, 0)
    const earlierDailyAverage = Math.max(earlierGain / (week.days - daily.days), 0.25)
    acceleration7d = daily.value / earlierDailyAverage
  }

  const forkWeek = week ? dailyRate(history, repository, 'forks', WEEK_WINDOW) : null
  const forkRatio7d = week && forkWeek && week.value * week.days >= FORK_RATIO_MIN_STARS
    ? forkWeek.value / week.value
    : null

  return {
    stars24h: daily ? Math.round(daily.value) : null,
    forks24h: forkDaily ? Math.round(forkDaily.value) : null,
    starVelocity,
    relativeGrowth: starVelocity === null ? null : relativeToSize(starVelocity, repository.stars),
    acceleration7d,
    forkRatio7d,
    ageDays,
    hoursSincePush: hoursBetween(repository.pushedAt, now),
    starsPerDay
  }
}

function relativeToSize(velocity: number, stars: number): number {
  return velocity / Math.sqrt(Math.max(stars, 0) + 25)
}

function quantile(values: number[], fraction: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))]
}

function liveBreakdowns(prepared: PreparedRepository[]): ScoreBreakdown[] {
  // Repositories without any baseline usually just entered the candidate pool because they are
  // rising, so they get an above-median velocity rather than zero.
  const imputedVelocity = quantile(
    prepared.flatMap(({ signals }) => signals.starVelocity ?? []),
    NO_BASELINE_QUANTILE
  )
  const velocities = prepared.map(({ signals }) => signals.starVelocity ?? imputedVelocity)
  const starMomentum = percentileRanks(velocities.map((velocity) => Math.log1p(velocity)))
  const relativeGrowth = percentileRanks(prepared.map(({ repository }, index) =>
    Math.log1p(relativeToSize(velocities[index], repository.stars))
  ))
  const acceleration = percentileRanks(prepared.map(({ signals }) => Math.log1p(signals.acceleration7d ?? 0)))
  const forkMomentum = percentileRanks(prepared.map(({ signals }) => Math.log1p(signals.forks24h ?? 0)))

  return prepared.map(({ signals }, index) => ({
    starMomentum: starMomentum[index] * 35,
    relativeGrowth: relativeGrowth[index] * 20,
    acceleration: acceleration[index] * 10,
    forkMomentum: forkMomentum[index] * 10,
    developmentActivity: clamp(Math.exp(-signals.hoursSincePush / (24 * 14))) * 15,
    freshness: clamp(Math.exp(-signals.ageDays / 120)) * 10
  }))
}

function warmupBreakdowns(prepared: PreparedRepository[]): ScoreBreakdown[] {
  const velocity = percentileRanks(prepared.map(({ signals }) => Math.log1p(signals.starsPerDay)))
  const popularity = percentileRanks(prepared.map(({ repository }) => Math.log1p(repository.stars)))

  return prepared.map(({ signals }, index) => ({
    starMomentum: velocity[index] * 35,
    relativeGrowth: velocity[index] * 20,
    acceleration: 0,
    forkMomentum: popularity[index] * 10,
    developmentActivity: clamp(Math.exp(-signals.hoursSincePush / (24 * 14))) * 20,
    freshness: clamp(Math.exp(-signals.ageDays / 120)) * 15
  }))
}

function totalScore(breakdown: ScoreBreakdown): number {
  return Object.values(breakdown).reduce((total, value) => total + value, 0)
}

export function scoreRepositories(
  repositories: GithubRepository[],
  options: ScoreRepositoriesOptions
): RankedRepository[] {
  const history = indexHistory(options.history ?? [], options.now)
  const prepared = repositories
    .filter((repository) => !repository.archived && !repository.fork)
    .map((repository) => ({
      repository,
      signals: buildSignals(repository, options.now, history, options.dailyGainHints?.get(repository.id))
    }))
  const hasDailyBaseline = prepared.some(({ signals }) => signals.stars24h !== null)
  const breakdowns = hasDailyBaseline ? liveBreakdowns(prepared) : warmupBreakdowns(prepared)
  const previousRanks = new Map(
    (options.previousRanking ?? []).map((repository) => [repository.id, repository.rank])
  )

  return prepared
    .map(({ repository, signals }, index) => {
      const categories = categorizeRepository(repository)
      const score = totalScore(breakdowns[index])
      return {
        ...repository,
        rank: 0,
        previousRank: previousRanks.get(repository.id) ?? null,
        rankChange: null,
        score: Math.round(score * 10) / 10,
        categories,
        signals,
        scoreBreakdown: breakdowns[index],
        research: buildResearch(repository, signals, categories)
      }
    })
    .sort((left, right) => right.score - left.score || right.stars - left.stars)
    .map((repository, index) => {
      const rank = index + 1
      return {
        ...repository,
        rank,
        rankChange: repository.previousRank === null ? null : repository.previousRank - rank
      }
    })
}
