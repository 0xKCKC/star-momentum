import { DEFAULT_CAUTION, FORK_SHARE_CAUTION_PREFIX } from '../domain/research'
import type { RankedRepository, StarAudit } from '../domain/repository'

// Samples each Top 50 repository's most recent stargazers through the GitHub REST API and
// looks for the account patterns found in fake-star studies:
// - "obvious fakes" (Dagster 2023): at most 4 repositories, at most 1 follower, an empty profile,
//   and an account created shortly before it starred;
// - accounts that starred several of today's Top 50 in the same recent window, a cheap stand-in
//   for StarScout's lockstep detection (He et al., ICSE 2026);
// - many stars landing in the same minute.
// GraphQL would fetch profiles in one query, but GitHub refuses `stargazers` to fine-grained
// tokens there, so this uses REST, falling back to the public events feed when the REST
// stargazers list is refused too. To stay within 5,000 requests an hour, profiles are only
// fetched for accounts whose id (GitHub assigns ids in creation order) suggests they are new,
// or that starred several of today's Top 50.
// Thresholds start conservative and are logged per repository for calibration. Any failure
// leaves the ranking untouched; nothing here changes scores or ranks.

const SAMPLE_SIZE = 100
const MIN_STARS_TO_AUDIT = 50
/** REST lists at most 400 pages of stargazers, so the newest are out of reach above this. */
const MAX_STARS_TO_AUDIT = 40_000
const CONCURRENCY = 5
const FRESH_ACCOUNT_DAYS = 30
/** Profiles are fetched when the id-based creation estimate is within this many days of the star. */
const ESTIMATE_MARGIN_DAYS = 60
const ANCHOR_COUNT = 9
const MAX_PROFILE_LOOKUPS = 1500
const SHARED_ACCOUNT_MIN_REPOSITORIES = 3
/** A repository is flagged when this share of sampled stargazers is suspicious... */
const FLAG_SHARE = 0.25
/** ...and at least this many of them are. */
const FLAG_MIN_ACCOUNTS = 15
const DAY = 86_400_000

interface StargazerItem {
  starred_at: string
  user: { login: string, id: number } | null
}

interface UserProfile {
  login: string
  created_at: string
  public_repos: number
  followers: number
  bio: string | null
  company: string | null
  location: string | null
  blog: string | null
}

export interface Stargazer {
  login: string
  starredAt: string
  createdAt: string
  hollow: boolean
}

/** GETs a GitHub REST path and returns the parsed body, or null on 404. */
export type GetJson = (path: string, accept?: string) => Promise<unknown>

interface AuditOptions {
  token?: string
  getJson?: GetJson
  log?: (message: string) => void
}

function restClient(token: string, onRemaining: (remaining: string) => void): GetJson {
  return async (path, accept = 'application/vnd.github+json') => {
    const response = await fetch(`https://api.github.com${path}`, {
      headers: {
        Accept: accept,
        Authorization: `Bearer ${token}`,
        'User-Agent': 'star-momentum',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      signal: AbortSignal.timeout(30_000)
    })
    const remaining = response.headers.get('x-ratelimit-remaining')
    if (remaining) onRemaining(remaining)
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`GitHub REST ${response.status} ${path}: ${(await response.text()).slice(0, 160)}`)
    return response.json()
  }
}

async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await task(items[index])
    }
  }))
  return results
}

interface RepositoryEvent {
  type: string
  created_at: string
  actor: { login: string, id: number } | null
}

/** Set once the stargazers endpoint refuses the token, so later repositories go straight to events. */
interface Source { useEvents: boolean }

// Fallback: GitHub refuses fine-grained tokens and GITHUB_TOKEN access to other repositories'
// stargazers, but the public events feed lists recent stars as WatchEvents (newest first, at most
// 300 events from the last 90 days, so busy repositories yield fewer).
async function recentWatchers(getJson: GetJson, repository: RankedRepository): Promise<StargazerItem[]> {
  const items: StargazerItem[] = []
  for (let page = 1; page <= 3 && items.length < SAMPLE_SIZE; page += 1) {
    const events = (await getJson(`/repos/${repository.fullName}/events?per_page=100&page=${page}`) ?? []) as RepositoryEvent[]
    for (const event of events) {
      if (event.type === 'WatchEvent' && event.actor) items.push({ starred_at: event.created_at, user: event.actor })
    }
    if (events.length < 100) break
  }
  return items.slice(0, SAMPLE_SIZE).reverse()
}

async function recentStars(getJson: GetJson, repository: RankedRepository, source: Source): Promise<StargazerItem[]> {
  if (!source.useEvents) {
    try {
      return await recentStargazers(getJson, repository)
    } catch (error) {
      if (!(error instanceof Error && /REST 403/.test(error.message))) throw error
      source.useEvents = true
    }
  }
  return recentWatchers(getJson, repository)
}

// Stargazers are listed oldest first, so the newest are on the last page or two.
async function recentStargazers(getJson: GetJson, repository: RankedRepository): Promise<StargazerItem[]> {
  const accept = 'application/vnd.github.star+json'
  const lastPage = Math.max(1, Math.ceil(repository.stars / SAMPLE_SIZE))
  const page = async (number: number) =>
    (await getJson(`/repos/${repository.fullName}/stargazers?per_page=${SAMPLE_SIZE}&page=${number}`, accept) ?? []) as StargazerItem[]
  let items = await page(lastPage)
  if (items.length < SAMPLE_SIZE && lastPage > 1) items = [...await page(lastPage - 1), ...items]
  return items.filter((item) => item.user).slice(-SAMPLE_SIZE)
}

function isHollow(profile: UserProfile): boolean {
  return profile.public_repos <= 4 && profile.followers <= 1 &&
    ![profile.bio, profile.company, profile.location, profile.blog].some((value) => value?.trim())
}

/** Piecewise-linear id -> creation time from a few known accounts; clamps outside their range. */
export function creationEstimator(anchors: Array<{ id: number, createdAt: number }>): (id: number) => number {
  const points = [...anchors].sort((left, right) => left.id - right.id)
  return (id) => {
    if (points.length === 0) return 0
    if (id <= points[0].id) return points[0].createdAt
    for (let index = 1; index < points.length; index += 1) {
      const low = points[index - 1]
      const high = points[index]
      if (id <= high.id) {
        const fraction = (id - low.id) / Math.max(high.id - low.id, 1)
        return low.createdAt + fraction * (high.createdAt - low.createdAt)
      }
    }
    return points[points.length - 1].createdAt
  }
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
  if (!options.getJson && !options.token) {
    log('Star audit skipped: no STAR_AUDIT_TOKEN.')
    return repositories
  }
  let remaining = 'unknown'
  const getJson = options.getJson ?? restClient(options.token!, (value) => { remaining = value })
  const targets = repositories.filter(({ stars }) => stars >= MIN_STARS_TO_AUDIT && stars <= MAX_STARS_TO_AUDIT)
  const tooLarge = repositories.filter(({ stars }) => stars > MAX_STARS_TO_AUDIT).length

  // 1. The newest stargazers of each repository.
  const items = new Map<number, StargazerItem[]>()
  const source: Source = { useEvents: false }
  let failures = 0
  await mapLimit(targets, CONCURRENCY, async (repository) => {
    try {
      const list = await recentStars(getJson, repository, source)
      if (list.length > 0) items.set(repository.id, list)
    } catch (error) {
      failures += 1
      if (failures <= 3) log(`Star audit failed for ${repository.fullName}: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
  if (items.size === 0) {
    log(`Star audit stopped: no stargazers could be read (${failures} failures).`)
    return repositories
  }

  // 2. Estimate account age from ids, anchored on a few profiles spread across the id range.
  const users = new Map<string, number>()
  const repositoriesPerLogin = new Map<string, number>()
  for (const list of items.values()) {
    for (const { user } of list) users.set(user!.login, user!.id)
    for (const login of new Set(list.map(({ user }) => user!.login))) {
      repositoriesPerLogin.set(login, (repositoriesPerLogin.get(login) ?? 0) + 1)
    }
  }
  const byId = [...users].sort((left, right) => left[1] - right[1])
  const anchorLogins = new Set(Array.from({ length: ANCHOR_COUNT }, (_, index) =>
    byId[Math.round((index / (ANCHOR_COUNT - 1)) * (byId.length - 1))][0]))
  const profiles = new Map<string, UserProfile>()
  const fetchProfiles = (logins: string[]) => mapLimit(logins, CONCURRENCY, async (login) => {
    try {
      const profile = await getJson(`/users/${login}`) as UserProfile | null
      if (profile) profiles.set(login, profile)
    } catch {
      failures += 1
    }
  })
  await fetchProfiles([...anchorLogins])
  const estimate = creationEstimator([...anchorLogins].flatMap((login) => profiles.has(login)
    ? [{ id: users.get(login)!, createdAt: Date.parse(profiles.get(login)!.created_at) }]
    : []))

  // 3. Profiles for accounts that may be new when they starred, or that starred 3+ of the Top 50.
  const candidates = new Map<string, number>()
  for (const list of items.values()) {
    for (const { starred_at: starredAt, user } of list) {
      const maybeNew = Date.parse(starredAt) - estimate(user!.id) <= ESTIMATE_MARGIN_DAYS * DAY
      const shared = (repositoriesPerLogin.get(user!.login) ?? 0) >= SHARED_ACCOUNT_MIN_REPOSITORIES
      if ((maybeNew || shared) && !profiles.has(user!.login)) candidates.set(user!.login, user!.id)
    }
  }
  const lookups = [...candidates].sort((left, right) => right[1] - left[1]).slice(0, MAX_PROFILE_LOOKUPS).map(([login]) => login)
  await fetchProfiles(lookups)

  const samples = new Map<number, Stargazer[]>()
  for (const [id, list] of items) {
    samples.set(id, list.map(({ starred_at: starredAt, user }) => {
      const profile = profiles.get(user!.login)
      return {
        login: user!.login,
        starredAt,
        createdAt: profile ? profile.created_at : new Date(estimate(user!.id)).toISOString(),
        hollow: profile ? isHollow(profile) : false
      }
    }))
  }
  const sharedLogins = new Set([...repositoriesPerLogin]
    .filter(([login, count]) => count >= SHARED_ACCOUNT_MIN_REPOSITORIES && profiles.has(login) && isHollow(profiles.get(login)!))
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
  log(`Star audit sampled ${samples.size}/${targets.length} repositories from ${source.useEvents ? 'events' : 'stargazers'} (${tooLarge} above ${MAX_STARS_TO_AUDIT} stars skipped); ` +
    `${profiles.size} profiles fetched (${candidates.size} candidates); ${sharedLogins.size} hollow accounts starred 3+ of the Top 50; ` +
    `${flagged} flagged; ${failures} failures; rate limit remaining ${remaining}.`)
  return result
}
