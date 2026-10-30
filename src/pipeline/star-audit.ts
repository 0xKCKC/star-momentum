import { DEFAULT_CAUTION, FORK_SHARE_CAUTION_PREFIX } from '../domain/research'
import type { RankedRepository, StarAudit } from '../domain/repository'

// Samples each Top 50 repository's most recent stargazers through the GitHub GraphQL API and
// looks for the account patterns found in fake-star studies:
// - "obvious fakes" (Dagster 2023): at most 4 repositories, at most 1 follower, an empty profile,
//   and an account created shortly before it starred;
// - accounts that starred several of today's Top 50 in the same recent window, a cheap stand-in
//   for StarScout's lockstep detection (He et al., ICSE 2026);
// - many stars landing in the same minute.
// Thresholds start conservative and are logged per repository for calibration. Any failure
// leaves the ranking untouched; nothing here changes scores or ranks.

const SAMPLE_SIZE = 100
const MIN_STARS_TO_AUDIT = 50
const REPOSITORIES_PER_QUERY = 5
const FRESH_ACCOUNT_DAYS = 30
const SHARED_ACCOUNT_MIN_REPOSITORIES = 3
/** A repository is flagged when this share of sampled stargazers is suspicious... */
const FLAG_SHARE = 0.25
/** ...and at least this many of them are. */
const FLAG_MIN_ACCOUNTS = 15

interface StargazerNode {
  login: string
  createdAt: string
  bio: string | null
  company: string | null
  location: string | null
  websiteUrl: string | null
  followers: { totalCount: number }
  repositories: { totalCount: number }
}

export interface StargazerEdge {
  starredAt: string
  node: StargazerNode | null
}

interface RepositoryStargazers {
  stargazers: { edges: StargazerEdge[] }
}

export interface Stargazer {
  login: string
  starredAt: string
  createdAt: string
  hollow: boolean
}

type GraphqlRequest = (query: string) => Promise<Record<string, RepositoryStargazers | null>>

interface GraphqlBody {
  data?: Record<string, RepositoryStargazers | null> | null
  errors?: Array<{ message: string, type?: string, path?: string[] }>
}

interface AuditOptions {
  token?: string
  request?: GraphqlRequest
  log?: (message: string) => void
}

function graphqlRequest(token: string, log: (message: string) => void): GraphqlRequest {
  return async (query) => {
    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'star-momentum'
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(30_000)
    })
    const body = await response.json() as GraphqlBody
    const errors = body.errors?.map(({ type, message }) => `${type ?? 'ERROR'}: ${message}`).slice(0, 3).join('; ')
    if (!response.ok || !body.data) throw new Error(`GitHub GraphQL ${response.status}: ${errors ?? 'no data'}`)
    // GraphQL can answer 200 with partial data; report the errors instead of silently sampling nothing.
    if (errors) log(`Star audit GraphQL errors: ${errors}`)
    return body.data
  }
}

function queryFor(repositories: RankedRepository[]): string {
  const parts = repositories.map((repository, index) => {
    const [owner, name] = repository.fullName.split('/')
    return `r${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
      stargazers(first: ${SAMPLE_SIZE}, orderBy: { field: STARRED_AT, direction: DESC }) {
        edges { starredAt node { login createdAt bio company location websiteUrl
          followers { totalCount } repositories { totalCount } } }
      }
    }`
  })
  return `query { ${parts.join('\n')} }`
}

function toStargazers(result: RepositoryStargazers | null): Stargazer[] {
  return (result?.stargazers.edges ?? []).flatMap(({ starredAt, node }) => node ? [{
    login: node.login,
    starredAt,
    createdAt: node.createdAt,
    hollow: node.repositories.totalCount <= 4 && node.followers.totalCount <= 1 &&
      ![node.bio, node.company, node.location, node.websiteUrl].some((value) => value?.trim())
  }] : [])
}

export function auditStargazers(stargazers: Stargazer[], sharedLogins: Set<string>): StarAudit {
  let fresh = 0
  let shared = 0
  let suspicious = 0
  const perMinute = new Map<string, number>()
  for (const stargazer of stargazers) {
    const ageAtStar = (Date.parse(stargazer.starredAt) - Date.parse(stargazer.createdAt)) / 86_400_000
    const isFresh = stargazer.hollow && ageAtStar <= FRESH_ACCOUNT_DAYS
    const isShared = stargazer.hollow && sharedLogins.has(stargazer.login)
    if (isFresh) fresh += 1
    if (isShared) shared += 1
    if (isFresh || isShared) suspicious += 1
    const minute = stargazer.starredAt.slice(0, 16)
    perMinute.set(minute, (perMinute.get(minute) ?? 0) + 1)
  }
  const sampled = stargazers.length
  const share = sampled > 0 ? suspicious / sampled : 0
  return {
    sampled,
    suspicious,
    freshHollow: fresh,
    sharedHollow: shared,
    maxPerMinute: Math.max(0, ...perMinute.values()),
    flagged: suspicious >= FLAG_MIN_ACCOUNTS && share >= FLAG_SHARE
  }
}

export function starInflationCaution(audit: StarAudit): string {
  const percent = Math.round((audit.suspicious / audit.sampled) * 100)
  return `最近 ${audit.sampled} 個加星帳戶中有 ${audit.suspicious} 個（${percent}%）是資料空白的新帳戶或同時為多個上榜項目加星，可能有刷星。`
}

export async function auditTopStargazers(
  repositories: RankedRepository[],
  options: AuditOptions = {}
): Promise<RankedRepository[]> {
  const log = options.log ?? (() => undefined)
  if (!options.request && !options.token) {
    log('Star audit skipped: no STAR_AUDIT_TOKEN.')
    return repositories
  }
  const request = options.request ?? graphqlRequest(options.token!, log)
  const targets = repositories.filter(({ stars }) => stars >= MIN_STARS_TO_AUDIT)
  const samples = new Map<number, Stargazer[]>()

  for (let start = 0; start < targets.length; start += REPOSITORIES_PER_QUERY) {
    const batch = targets.slice(start, start + REPOSITORIES_PER_QUERY)
    try {
      const data = await request(queryFor(batch))
      batch.forEach((repository, index) => samples.set(repository.id, toStargazers(data[`r${index}`] ?? null)))
    } catch (error) {
      log(`Star audit batch ${start / REPOSITORIES_PER_QUERY + 1} failed: ${error instanceof Error ? error.message : String(error)}`)
      if (samples.size === 0 && start === 0) {
        log('Star audit stopped after the first batch failed.')
        return repositories
      }
    }
  }

  // Hollow accounts that recently starred several of today's Top 50.
  const repositoriesPerLogin = new Map<string, number>()
  for (const stargazers of samples.values()) {
    for (const login of new Set(stargazers.filter(({ hollow }) => hollow).map(({ login }) => login))) {
      repositoriesPerLogin.set(login, (repositoriesPerLogin.get(login) ?? 0) + 1)
    }
  }
  const sharedLogins = new Set([...repositoriesPerLogin]
    .filter(([, count]) => count >= SHARED_ACCOUNT_MIN_REPOSITORIES)
    .map(([login]) => login))

  let flagged = 0
  const result = repositories.map((repository) => {
    const stargazers = samples.get(repository.id)
    if (!stargazers || stargazers.length === 0) return repository
    const audit = auditStargazers(stargazers, sharedLogins)
    log(`Star audit: ${repository.fullName} sampled=${audit.sampled} suspicious=${audit.suspicious} ` +
      `freshHollow=${audit.freshHollow} sharedHollow=${audit.sharedHollow} maxPerMinute=${audit.maxPerMinute}` +
      (audit.flagged ? ' FLAGGED' : ''))
    if (audit.flagged) flagged += 1

    // A clean sample outweighs the coarse fork-share screen, so that caution is dropped.
    const clean = audit.suspicious / audit.sampled < 0.1
    const kept = repository.research.cautions.filter((caution) =>
      !(clean && caution.startsWith(FORK_SHARE_CAUTION_PREFIX)))
    const cautions = kept.length > 0 ? kept : [DEFAULT_CAUTION]
    const risks = repository.research.risks ?? []
    return {
      ...repository,
      research: {
        ...repository.research,
        starAudit: audit,
        evidence: [
          ...repository.research.evidence,
          `近期加星帳戶抽樣：${audit.sampled} 個中 ${audit.suspicious} 個可疑`
        ],
        cautions: audit.flagged ? [starInflationCaution(audit), ...cautions] : cautions,
        ...(audit.flagged ? { risks: [...risks, 'starInflation' as const] } : {})
      }
    }
  })
  const empty = [...samples.values()].filter((stargazers) => stargazers.length === 0).length
  if (empty > 0) log(`Star audit: ${empty} repositories returned no stargazers.`)
  log(`Star audit sampled ${samples.size - empty}/${targets.length} repositories; ${sharedLogins.size} hollow accounts starred 3+ of the Top 50; ${flagged} flagged.`)
  return result
}
