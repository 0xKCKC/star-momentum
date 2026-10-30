import type { HackerNewsExposure, RankedRepository } from '../domain/repository'

// Looks up recent Hacker News stories linking to each Top 50 repository through the free HN
// Algolia API (no key). Exposure is the main driver of star spikes in the literature (e.g.
// Borges & Valente 2019; Fang et al., ICSE 2022), so it explains where a spike came from.
// It never changes scores or ranks, and any failure leaves the ranking untouched.

const WINDOW_DAYS = 14
const CONCURRENCY = 5

interface AlgoliaHit {
  objectID: string
  url: string | null
  points: number | null
  num_comments: number | null
  created_at: string
}

type Fetch = typeof fetch

interface HackerNewsOptions {
  now: Date
  fetchImpl?: Fetch
  log?: (message: string) => void
}

function linksTo(url: string | null, fullName: string): boolean {
  if (!url) return false
  const match = url.toLowerCase().match(/^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)/)
  return match !== null && `${match[1]}/${match[2].replace(/\.git$/, '')}` === fullName.toLowerCase()
}

export function bestStory(hits: AlgoliaHit[], fullName: string): HackerNewsExposure | null {
  const stories = hits.filter((hit) => linksTo(hit.url, fullName))
  if (stories.length === 0) return null
  const best = stories.reduce((top, hit) => ((hit.points ?? 0) > (top.points ?? 0) ? hit : top))
  return {
    points: best.points ?? 0,
    comments: best.num_comments ?? 0,
    postedAt: best.created_at,
    url: `https://news.ycombinator.com/item?id=${best.objectID}`
  }
}

async function lookup(fetchImpl: Fetch, fullName: string, since: number): Promise<HackerNewsExposure | null> {
  const url = new URL('https://hn.algolia.com/api/v1/search')
  url.searchParams.set('query', `github.com/${fullName}`)
  url.searchParams.set('restrictSearchableAttributes', 'url')
  url.searchParams.set('tags', 'story')
  url.searchParams.set('numericFilters', `created_at_i>${since}`)
  url.searchParams.set('hitsPerPage', '20')
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`HN Algolia ${response.status}`)
  const body = await response.json() as { hits?: AlgoliaHit[] }
  return bestStory(body.hits ?? [], fullName)
}

export function hackerNewsEvidence(exposure: HackerNewsExposure, now: Date): string {
  const hours = Math.max(0, (now.getTime() - Date.parse(exposure.postedAt)) / 3_600_000)
  const when = hours < 48 ? `${Math.round(hours)} 小時前` : `${Math.round(hours / 24)} 日前`
  return `Hacker News：${exposure.points} 分、${exposure.comments} 則評論（${when}）`
}

export async function addHackerNewsExposure(
  repositories: RankedRepository[],
  options: HackerNewsOptions
): Promise<RankedRepository[]> {
  const log = options.log ?? (() => undefined)
  const fetchImpl = options.fetchImpl ?? fetch
  const since = Math.floor(options.now.getTime() / 1000) - WINDOW_DAYS * 86_400
  const found = new Map<number, HackerNewsExposure>()
  const pending = [...repositories]
  let failures = 0

  const worker = async () => {
    for (let repository = pending.shift(); repository; repository = pending.shift()) {
      try {
        const exposure = await lookup(fetchImpl, repository.fullName, since)
        if (exposure) found.set(repository.id, exposure)
      } catch (error) {
        failures += 1
        if (failures <= 3) log(`HN lookup failed for ${repository.fullName}: ${error instanceof Error ? error.message : String(error)}`)
        if (failures >= 10) pending.length = 0
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  log(`Hacker News: ${found.size}/${repositories.length} repositories had a story in the last ${WINDOW_DAYS} days (${failures} lookups failed).`)
  return repositories.map((repository) => {
    const exposure = found.get(repository.id)
    if (!exposure) return repository
    return {
      ...repository,
      research: {
        ...repository.research,
        hackerNews: exposure,
        evidence: [...repository.research.evidence, hackerNewsEvidence(exposure, options.now)]
      }
    }
  })
}
