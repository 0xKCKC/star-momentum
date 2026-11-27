import type { GithubTrendingComparison, RankedRepository } from '../domain/repository'
import type { ChartDay } from './chart-history'

// Reads GitHub's own Trending pages (public HTML, no key). The names widen the candidate pool
// (see addNamedRepositories), and the daily page marks which Top 50 repositories GitHub also
// lists and which ones this ranking listed first. Lead times are only
// claimed for repositories first charted after tracking began, because before that there is no
// record of what Trending showed. The marks never change scores or ranks, and any failure
// (network, changed markup) leaves the ranking untouched.

const TRENDING_URL = 'https://github.com/trending?since='
// A healthy page lists up to 25 repositories; fewer than this means the markup changed.
const MIN_PARSED = 5

type Fetch = typeof fetch

interface GithubTrendingOptions {
  now: Date
  today: string
  days: ChartDay[]
  /** The previous update, which may be from earlier today. */
  previous?: { dataDate: string, githubTrending?: GithubTrendingComparison, repositories: RankedRepository[] } | null
  /** Lower-cased full names on the daily Trending page. */
  listed: Set<string>
  log?: (message: string) => void
}

export interface TrendingNames {
  daily: Set<string>
  weekly: Set<string>
  /** Stars gained today for the daily page's repositories, where the page states it. */
  dailyGains: Map<string, number>
}

async function fetchPage(fetchImpl: Fetch, since: 'daily' | 'weekly'): Promise<{ names: Set<string>, gains: Map<string, number> }> {
  const response = await fetchImpl(`${TRENDING_URL}${since}`, {
    headers: { Accept: 'text/html', 'User-Agent': 'star-momentum' },
    signal: AbortSignal.timeout(20_000)
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const html = await response.text()
  const parsed = parseTrending(html)
  if (parsed.length < MIN_PARSED) throw new Error(`only ${parsed.length} repositories parsed`)
  return { names: new Set(parsed), gains: parseTrendingGains(html) }
}

/** Null when the daily page cannot be read; the weekly page is optional. */
export async function fetchTrendingNames(
  options: { fetchImpl?: Fetch, log?: (message: string) => void } = {}
): Promise<TrendingNames | null> {
  const log = options.log ?? (() => undefined)
  const fetchImpl = options.fetchImpl ?? fetch
  try {
    const daily = await fetchPage(fetchImpl, 'daily')
    const weekly = await fetchPage(fetchImpl, 'weekly').then(({ names }) => names).catch(() => new Set<string>())
    log(`GitHub Trending: ${daily.names.size} repositories on the daily page (${daily.gains.size} with stars today), ${weekly.size} on the weekly page.`)
    return { daily: daily.names, weekly, dailyGains: daily.gains }
  } catch (error) {
    log(`GitHub Trending skipped: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

export function parseTrending(html: string): string[] {
  const names = new Set<string>()
  for (const match of html.matchAll(/<h2[^>]*>\s*<a[^>]*\bhref="\/([\w.-]+)\/([\w.-]+)"/g)) {
    names.add(`${match[1]}/${match[2]}`.toLowerCase())
  }
  return [...names]
}

/** Stars gained today as printed on the page, by lower-cased full name. */
export function parseTrendingGains(html: string): Map<string, number> {
  const gains = new Map<string, number>()
  for (const article of html.split(/<article\b/).slice(1)) {
    const name = parseTrending(article)[0]
    const gain = article.match(/([\d,]+)\s+stars?\s+today/)
    if (name && gain) gains.set(name, Number.parseInt(gain[1].replace(/,/g, ''), 10))
  }
  return gains
}

function daysBetweenDates(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

export function addGithubTrending(
  repositories: RankedRepository[],
  options: GithubTrendingOptions
): { repositories: RankedRepository[], comparison: GithubTrendingComparison } {
  const log = options.log ?? (() => undefined)
  const listedNames = options.listed

  // Earlier sightings, from stored days and from an earlier update today.
  const records = [
    ...options.days,
    ...(options.previous ? [{
      date: options.previous.dataDate,
      repositories: options.previous.repositories,
      githubTrending: options.previous.githubTrending
    }] : [])
  ]
  const firstListed = new Map<number, string>()
  let trackedSince = options.today
  for (const record of records) {
    if (record.githubTrending && record.githubTrending.trackedSince < trackedSince) {
      trackedSince = record.githubTrending.trackedSince
    }
    for (const { id, research } of record.repositories) {
      const date = research?.githubTrending?.firstListed
      if (date && date < (firstListed.get(id) ?? '9999')) firstListed.set(id, date)
    }
  }

  const marked = repositories.map((repository) => {
    const listed = listedNames.has(repository.fullName.toLowerCase())
    const first = firstListed.get(repository.id) ?? (listed ? options.today : null)
    const charted = repository.research.chart?.firstSeen ?? options.today
    const lead = first && charted >= trackedSince ? daysBetweenDates(charted, first) : 0
    const status = { listed, firstListed: first, leadDays: lead > 0 ? lead : null }
    return {
      ...repository,
      research: {
        ...repository.research,
        githubTrending: status,
        evidence: [...repository.research.evidence, githubTrendingEvidence(status)]
      }
    }
  })
  const unlisted = marked.filter(({ research }) => !research.githubTrending.listed).length
  log(`GitHub Trending: ${marked.length - unlisted}/${marked.length} of the Top 50 are also on its daily page.`)
  return {
    repositories: marked,
    comparison: { checkedAt: options.now.toISOString(), trackedSince, size: listedNames.size, unlisted }
  }
}

export function githubTrendingEvidence(status: NonNullable<RankedRepository['research']['githubTrending']>): string {
  if (status.leadDays) return `GitHub Trending 日榜：本榜早 ${status.leadDays} 日收錄`
  if (status.listed) return 'GitHub Trending 日榜：今日同樣上榜'
  return status.firstListed
    ? `GitHub Trending 日榜：今日不在榜（${status.firstListed} 曾上榜）`
    : 'GitHub Trending 日榜：不在榜'
}
