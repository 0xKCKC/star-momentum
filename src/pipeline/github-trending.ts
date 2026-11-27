import type { GithubTrendingComparison, RankedRepository } from '../domain/repository'
import type { ChartDay } from './chart-history'

// Reads GitHub's own daily Trending page (public HTML, no key) and marks which Top 50
// repositories it does not list, and which ones this ranking listed first. Lead times are only
// claimed for repositories first charted after tracking began, because before that there is no
// record of what Trending showed. It never changes scores or ranks, and any failure (network,
// changed markup) leaves the ranking untouched.

const TRENDING_URL = 'https://github.com/trending?since=daily'
// A healthy page lists up to 25 repositories; fewer than this means the markup changed.
const MIN_PARSED = 5

type Fetch = typeof fetch

interface GithubTrendingOptions {
  now: Date
  today: string
  days: ChartDay[]
  /** The previous update, which may be from earlier today. */
  previous?: { dataDate: string, githubTrending?: GithubTrendingComparison, repositories: RankedRepository[] } | null
  fetchImpl?: Fetch
  log?: (message: string) => void
}

export function parseTrending(html: string): string[] {
  const names = new Set<string>()
  for (const match of html.matchAll(/<h2[^>]*>\s*<a[^>]*\bhref="\/([\w.-]+)\/([\w.-]+)"/g)) {
    names.add(`${match[1]}/${match[2]}`.toLowerCase())
  }
  return [...names]
}

function daysBetweenDates(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

export async function addGithubTrending(
  repositories: RankedRepository[],
  options: GithubTrendingOptions
): Promise<{ repositories: RankedRepository[], comparison?: GithubTrendingComparison }> {
  const log = options.log ?? (() => undefined)
  let listedNames: Set<string>
  try {
    const response = await (options.fetchImpl ?? fetch)(TRENDING_URL, {
      headers: { Accept: 'text/html', 'User-Agent': 'github-daily-research-ranking' },
      signal: AbortSignal.timeout(20_000)
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const parsed = parseTrending(await response.text())
    if (parsed.length < MIN_PARSED) throw new Error(`only ${parsed.length} repositories parsed`)
    listedNames = new Set(parsed)
  } catch (error) {
    log(`GitHub Trending comparison skipped: ${error instanceof Error ? error.message : String(error)}`)
    return { repositories }
  }

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
  log(`GitHub Trending: ${listedNames.size} repositories listed there; ${unlisted}/${marked.length} of the Top 50 are not on it.`)
  return {
    repositories: marked,
    comparison: { checkedAt: options.now.toISOString(), trackedSince, size: listedNames.size, unlisted }
  }
}

export function githubTrendingEvidence(status: NonNullable<RankedRepository['research']['githubTrending']>): string {
  if (status.leadDays) return `GitHub Trending 日榜：本榜早 ${status.leadDays} 日收錄`
  if (status.listed) return 'GitHub Trending 日榜：今日同樣上榜'
  return status.firstListed
    ? `GitHub Trending 日榜：今日未見（${status.firstListed} 曾上榜）`
    : 'GitHub Trending 日榜：未見'
}
