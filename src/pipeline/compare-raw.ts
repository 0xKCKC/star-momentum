import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { RankingDocument, RepositorySnapshot } from '../domain/repository'

// How different is the published Top 50 from simply sorting by stars gained that day, which is
// what GitHub Trending does? Uses the stored snapshots and published history only.

const RAW_TOP = 25
const WARMUP_DAYS = 10

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1)
}

async function readDated<T>(directory: string): Promise<Map<string, T>> {
  const names = (await readdir(directory)).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort()
  const entries = await Promise.all(names.map(async (name) =>
    [name.slice(0, 10), JSON.parse(await readFile(join(directory, name), 'utf8')) as T] as const
  ))
  return new Map(entries)
}

async function run(): Promise<void> {
  const root = resolve(process.cwd())
  const snapshots = await readDated<RepositorySnapshot>(join(root, 'data', 'snapshots'))
  const published = await readDated<RankingDocument>(join(root, 'public', 'data', 'history'))
  const dates = [...snapshots.keys()]

  const overlap: number[] = []
  const ourMedian: number[] = []
  const rawMedian: number[] = []
  const firstOurs = new Map<number, string>()
  const firstRaw = new Map<number, string>()
  const usable: string[] = []

  for (let index = 1; index < dates.length; index += 1) {
    const today = snapshots.get(dates[index])!
    const yesterday = snapshots.get(dates[index - 1])!
    const document = published.get(dates[index])
    const days = (Date.parse(today.capturedAt) - Date.parse(yesterday.capturedAt)) / 86_400_000
    if (!document || days < 0.4) continue
    const before = new Map(yesterday.repositories.map((entry) => [entry.id, entry.stars]))
    const raw = today.repositories
      .filter((entry) => before.has(entry.id))
      .map((entry) => ({ id: entry.id, stars: entry.stars, gain: (entry.stars - before.get(entry.id)!) / days }))
      .sort((left, right) => right.gain - left.gain)
    const ours = document.repositories
    const ourIds = new Set(ours.map(({ id }) => id))
    const rawTop = raw.slice(0, ours.length)

    usable.push(dates[index])
    overlap.push(rawTop.filter(({ id }) => ourIds.has(id)).length / ours.length)
    ourMedian.push(median(ours.map(({ stars }) => stars)))
    rawMedian.push(median(rawTop.map(({ stars }) => stars)))
    for (const { id } of ours) if (!firstOurs.has(id)) firstOurs.set(id, dates[index])
    for (const { id } of raw.slice(0, RAW_TOP)) if (!firstRaw.has(id)) firstRaw.set(id, dates[index])
  }

  const start = usable[WARMUP_DAYS] ?? '9999'
  const leads: number[] = []
  let sameDay = 0
  let later = 0
  let never = 0
  for (const [id, date] of firstRaw) {
    if (date < start) continue
    const ours = firstOurs.get(id)
    if (!ours) never += 1
    else if (ours < date) leads.push((Date.parse(date) - Date.parse(ours)) / 86_400_000)
    else if (ours === date) sameDay += 1
    else later += 1
  }
  const reached = leads.length + sameDay + later + never

  process.stdout.write([
    `days compared: ${usable.length}`,
    `Top 50 shared with the raw star-gain Top 50: ${(mean(overlap) * 100).toFixed(0)}%`,
    `median total stars: this ranking ${Math.round(mean(ourMedian))}, raw star gain ${Math.round(mean(rawMedian))}`,
    `repositories reaching the raw Top ${RAW_TOP}: ${reached}`,
    `  listed here earlier: ${leads.length} (${(leads.length / Math.max(reached, 1) * 100).toFixed(0)}%), median lead ${median(leads)} day(s)`,
    `  same day: ${sameDay}, later here: ${later}, never listed here: ${never}`
  ].join('\n') + '\n')
}

run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
