import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { percentileRanks } from '../domain/numbers'
import type { GithubRepository, RepositorySnapshot } from '../domain/repository'
import { scoreRepositories } from '../domain/scoring'

// Replays rankings on each stored daily snapshot using only data available that day, then
// checks them against the star growth that actually happened over the next 1, 3 and 7 days.
//
// - The candidate pool and every normalisation use day t's snapshot and earlier ones only.
// - The top 50 is fixed before looking at the future. A repository that left the candidate
//   pool by the target day has unknown growth and counts as a miss, never as a reason to
//   promote the next one.
// - Snapshots do not store createdAt, so the production score's freshness term is neutral.

const HISTORY_SIZE = 8
const TOP = 50

type SnapshotEntry = RepositorySnapshot['repositories'][number]

interface DayContext {
  snapshots: RepositorySnapshot[]
  day: number
  today: RepositorySnapshot
}

/** Returns repository ids ordered from best to worst. */
type Ranker = (context: DayContext) => number[]

function spearman(left: number[], right: number[]): number {
  if (left.length < 3) return Number.NaN
  const leftRanks = percentileRanks(left)
  const rightRanks = percentileRanks(right)
  const mean = (values: number[]) => values.reduce((total, value) => total + value, 0) / values.length
  const leftMean = mean(leftRanks)
  const rightMean = mean(rightRanks)
  let covariance = 0
  let leftVariance = 0
  let rightVariance = 0
  leftRanks.forEach((value, index) => {
    covariance += (value - leftMean) * (rightRanks[index] - rightMean)
    leftVariance += (value - leftMean) ** 2
    rightVariance += (rightRanks[index] - rightMean) ** 2
  })
  return covariance / Math.sqrt(leftVariance * rightVariance)
}

function toRepository(entry: SnapshotEntry): GithubRepository {
  const [owner, name] = entry.fullName.split('/')
  return {
    id: entry.id,
    nodeId: '',
    name,
    fullName: entry.fullName,
    owner,
    ownerAvatarUrl: '',
    url: '',
    description: '',
    language: null,
    topics: [],
    stars: entry.stars,
    forks: entry.forks,
    openIssues: entry.openIssues,
    createdAt: '2000-01-01T00:00:00Z',
    updatedAt: entry.pushedAt,
    pushedAt: entry.pushedAt,
    license: null,
    archived: false,
    fork: false
  }
}

async function loadSnapshots(root: string): Promise<RepositorySnapshot[]> {
  const directory = join(root, 'data', 'snapshots')
  const names = (await readdir(directory)).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort()
  return Promise.all(names.map(async (name) =>
    JSON.parse(await readFile(join(directory, name), 'utf8')) as RepositorySnapshot
  ))
}

function daysApart(later: RepositorySnapshot, earlier: RepositorySnapshot): number {
  return (Date.parse(later.capturedAt) - Date.parse(earlier.capturedAt)) / 86_400_000
}

function byScore(scores: Map<number, number>): number[] {
  return [...scores].sort((left, right) => right[1] - left[1]).map(([id]) => id)
}

const production: Ranker = ({ snapshots, day, today }) => scoreRepositories(today.repositories.map(toRepository), {
  now: today.capturedAt,
  history: snapshots.slice(day - HISTORY_SIZE, day)
}).map(({ id }) => id)

// Stars gained per day over the last `days` snapshots; repositories without a baseline score 0.
function velocity(days: number, transform: (gain: number, entry: SnapshotEntry, past: SnapshotEntry) => number): Ranker {
  return ({ snapshots, day, today }) => {
    const past = snapshots[Math.max(0, day - days)]
    const pastEntries = new Map(past.repositories.map((entry) => [entry.id, entry]))
    const span = Math.max(daysApart(today, past), 0.5)
    return byScore(new Map(today.repositories.map((entry) => {
      const previous = pastEntries.get(entry.id)
      return [entry.id, previous ? transform(Math.max(0, entry.stars - previous.stars) / span, entry, previous) : -1]
    })))
  }
}

// OSS Insight's public trending formula, adapted to daily snapshots: stars count 2-5 and forks
// 1-4 depending on how recent the day is, over the last 7 days. Its new-repository bonus needs
// createdAt, which snapshots do not store.
const ossInsight: Ranker = ({ snapshots, day, today }) => {
  const scores = new Map<number, number>(today.repositories.map((entry) => [entry.id, 0]))
  const window = Math.min(7, day)
  for (let back = 0; back < window; back += 1) {
    const later = new Map(snapshots[day - back].repositories.map((entry) => [entry.id, entry]))
    const earlier = new Map(snapshots[day - back - 1].repositories.map((entry) => [entry.id, entry]))
    const recency = 1 - back / Math.max(window - 1, 1)
    for (const [id, entry] of later) {
      const previous = earlier.get(id)
      if (!previous || !scores.has(id)) continue
      const stars = Math.max(0, entry.stars - previous.stars)
      const forks = Math.max(0, entry.forks - previous.forks)
      scores.set(id, scores.get(id)! + stars * (2 + 3 * recency) + forks * (1 + 3 * recency))
    }
  }
  return byScore(scores)
}

const rankers: Record<string, Ranker> = {
  production,
  'velocity 3d': velocity(3, (rate) => rate),
  'log growth 3d': velocity(3, (_rate, entry, past) => Math.log((entry.stars + 10) / (past.stars + 10))),
  'oss insight 7d': ossInsight
}

interface Totals {
  spearman: number
  bucketSpearman: number
  precision: number
  lift: number
  ndcg: number
  breakoutLift: number
  breakoutDays: number
  stability: number
  stabilityDays: number
  dropped: number
  days: number
}

function evaluate(snapshots: RepositorySnapshot[], horizon: number, ranker: Ranker) {
  const totals: Totals = {
    spearman: 0, bucketSpearman: 0, precision: 0, lift: 0, ndcg: 0, breakoutLift: 0,
    breakoutDays: 0, stability: 0, stabilityDays: 0, dropped: 0, days: 0
  }
  let previousTop: Set<number> | null = null

  for (let day = HISTORY_SIZE; day + horizon < snapshots.length; day += 1) {
    const today = snapshots[day]
    const futureSnapshot = snapshots[day + horizon]
    const future = new Map(futureSnapshot.repositories.map((entry) => [entry.id, entry]))
    const weekAgo = new Map(snapshots[day - 7].repositories.map((entry) => [entry.id, entry]))
    const elapsed = daysApart(futureSnapshot, today)
    const pastSpan = daysApart(today, snapshots[day - 7])
    const order = ranker({ snapshots, day, today })
    const top = order.slice(0, TOP)
    const todayEntries = new Map(today.repositories.map((entry) => [entry.id, entry]))

    // Targets are computed only over repositories whose future is known.
    const known = order.filter((id) => future.has(id))
    const forward = known.map((id) => Math.max(0, future.get(id)!.stars - todayEntries.get(id)!.stars) / elapsed)
    const absolute = percentileRanks(forward.map((gain) => Math.log1p(gain)))
    const relative = percentileRanks(forward.map((gain, index) =>
      Math.log1p(gain / Math.sqrt(todayEntries.get(known[index])!.stars + 25))))
    const target = new Map(known.map((id, index) => [id, 0.6 * absolute[index] + 0.4 * relative[index]]))
    const targetTop = new Set([...target].sort((left, right) => right[1] - left[1]).slice(0, TOP).map(([id]) => id))

    // Rank correlation over known repositories, overall and within star-size terciles.
    const predicted = percentileRanks(known.map((id) => -order.indexOf(id)))
    totals.spearman += spearman(predicted, known.map((id) => target.get(id)!))
    const sizes = known.map((id) => todayEntries.get(id)!.stars)
    const cuts = [...sizes].sort((left, right) => left - right)
    const bounds = [cuts[Math.floor(cuts.length / 3)], cuts[Math.floor((2 * cuts.length) / 3)]]
    const buckets = [0, 1, 2].map((bucket) => known
      .map((id, index) => ({ id, index }))
      .filter(({ index }) => (sizes[index] < bounds[0] ? 0 : sizes[index] < bounds[1] ? 1 : 2) === bucket))
    const bucketValues = buckets
      .map((members) => spearman(members.map(({ index }) => predicted[index]), members.map(({ id }) => target.get(id)!)))
      .filter((value) => Number.isFinite(value))
    totals.bucketSpearman += bucketValues.reduce((total, value) => total + value, 0) / bucketValues.length

    // Precision@50 and lift over the random base rate; unknown futures count as misses.
    const hits = top.filter((id) => targetTop.has(id)).length
    totals.precision += hits / TOP
    totals.lift += (hits / TOP) / (TOP / known.length)
    totals.dropped += top.filter((id) => !future.has(id)).length / TOP

    // NDCG@50 with the composite target as graded relevance.
    const dcg = top.reduce((total, id, index) => total + (target.get(id) ?? 0) / Math.log2(index + 2), 0)
    const ideal = [...target.values()].sort((left, right) => right - left).slice(0, TOP)
      .reduce((total, value, index) => total + value / Math.log2(index + 2), 0)
    totals.ndcg += dcg / ideal

    // Breakouts: forward daily growth at least double the past week's, and at least 10 stars a day.
    const breakouts = new Set(known.filter((id) => {
      const past = weekAgo.get(id)
      const pastRate = past ? Math.max(0, todayEntries.get(id)!.stars - past.stars) / pastSpan : 0
      const futureRate = Math.max(0, future.get(id)!.stars - todayEntries.get(id)!.stars) / elapsed
      return futureRate >= 10 && futureRate >= 2 * pastRate
    }))
    if (breakouts.size > 0) {
      const breakoutHits = top.filter((id) => breakouts.has(id)).length
      totals.breakoutLift += (breakoutHits / TOP) / (breakouts.size / known.length)
      totals.breakoutDays += 1
    }

    const topSet = new Set(top)
    if (previousTop) {
      totals.stability += top.filter((id) => previousTop!.has(id)).length / TOP
      totals.stabilityDays += 1
    }
    previousTop = topSet
    totals.days += 1
  }

  const average = (value: number, count = totals.days) => count > 0 ? value / count : Number.NaN
  return {
    days: totals.days,
    spearman: average(totals.spearman),
    bucketSpearman: average(totals.bucketSpearman),
    precision: average(totals.precision),
    lift: average(totals.lift),
    ndcg: average(totals.ndcg),
    breakoutLift: average(totals.breakoutLift, totals.breakoutDays),
    stability: average(totals.stability, totals.stabilityDays),
    dropped: average(totals.dropped)
  }
}

async function run(): Promise<void> {
  const snapshots = await loadSnapshots(resolve(process.cwd()))
  if (snapshots.length < HISTORY_SIZE + 2) {
    throw new Error(`Need at least ${HISTORY_SIZE + 2} snapshots, found ${snapshots.length}`)
  }
  const only = process.argv.slice(2)
  const selected = Object.entries(rankers).filter(([name]) => only.length === 0 || only.includes(name))

  for (const horizon of [1, 3, 7]) {
    process.stdout.write(`\nforward ${horizon}d\n`)
    process.stdout.write('ranker                  days  spearman  bucket  p@50   lift   ndcg@50  breakout  stability  dropped\n')
    for (const [name, ranker] of selected) {
      const result = evaluate(snapshots, horizon, ranker)
      if (result.days === 0) continue
      process.stdout.write(
        `${name.padEnd(22)}  ${String(result.days).padStart(4)}  ${result.spearman.toFixed(3).padStart(8)}  ` +
        `${result.bucketSpearman.toFixed(3).padStart(6)}  ${result.precision.toFixed(3)}  ${result.lift.toFixed(2).padStart(5)}  ` +
        `${result.ndcg.toFixed(3).padStart(7)}  ${result.breakoutLift.toFixed(2).padStart(8)}  ` +
        `${result.stability.toFixed(3).padStart(9)}  ${result.dropped.toFixed(3).padStart(7)}\n`
      )
    }
  }
}

run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
