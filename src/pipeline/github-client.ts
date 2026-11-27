import type { GithubRepository } from '../domain/repository'

interface GithubSearchResponse {
  total_count: number
  incomplete_results: boolean
  items: GithubRepositoryResponse[]
}

interface GithubRepositoryResponse {
  id: number
  node_id: string
  name: string
  full_name: string
  owner: {
    login: string
    avatar_url: string
  }
  html_url: string
  description: string | null
  language: string | null
  topics?: string[]
  stargazers_count: number
  forks_count: number
  open_issues_count: number
  created_at: string
  updated_at: string
  pushed_at: string
  license: {
    spdx_id: string | null
    name: string
  } | null
  archived: boolean
  fork: boolean
}

export class GithubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfter: string | null
  ) {
    super(message)
    this.name = 'GithubApiError'
  }
}

function toRepository(item: GithubRepositoryResponse): GithubRepository {
  return {
    id: item.id,
    nodeId: item.node_id,
    name: item.name,
    fullName: item.full_name,
    owner: item.owner.login,
    ownerAvatarUrl: item.owner.avatar_url,
    url: item.html_url,
    description: normalizeGithubText(item.description ?? ''),
    language: item.language,
    topics: item.topics ?? [],
    stars: item.stargazers_count,
    forks: item.forks_count,
    openIssues: item.open_issues_count,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    pushedAt: item.pushed_at,
    license: item.license?.spdx_id && item.license.spdx_id !== 'NOASSERTION'
      ? item.license.spdx_id
      : null,
    archived: item.archived,
    fork: item.fork
  }
}

export function normalizeGithubText(value: string): string {
  return value
    .replace(/[—–]/g, ' - ')
    .replace(/\s+/g, ' ')
    .trim()
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export class GithubClient {
  private readonly token?: string

  constructor(token = process.env.GITHUB_TOKEN) {
    this.token = token || undefined
  }

  async searchRepositories(query: string): Promise<GithubRepository[]> {
    const url = new URL('https://api.github.com/search/repositories')
    url.searchParams.set('q', query)
    url.searchParams.set('sort', 'stars')
    url.searchParams.set('order', 'desc')
    url.searchParams.set('per_page', '100')

    const response = await this.request<GithubSearchResponse>(url)
    await delay(this.token ? 250 : 800)
    return response.items.map(toRepository)
  }

  /** One repository by full name; null when it no longer exists or cannot be read. */
  async getRepository(fullName: string): Promise<GithubRepository | null> {
    try {
      const item = await this.request<GithubRepositoryResponse>(new URL(`https://api.github.com/repos/${fullName}`))
      return toRepository(item)
    } catch (error) {
      if (error instanceof GithubApiError && [403, 404, 451].includes(error.status)) return null
      throw error
    }
  }

  private async request<T>(url: URL, attempt = 0): Promise<T> {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'star-momentum',
        'X-GitHub-Api-Version': '2026-03-10',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
      }
    })

    if (!response.ok) {
      const retryAfter = response.headers.get('retry-after')
      const rateRemaining = response.headers.get('x-ratelimit-remaining')
      const rateReset = response.headers.get('x-ratelimit-reset')
      const isRateLimited = response.status === 429 || (response.status === 403 && rateRemaining === '0')
      const mayRetry = attempt < 2 && (isRateLimited || response.status >= 500)
      if (mayRetry) {
        const resetWait = rateReset
          ? Number.parseInt(rateReset, 10) * 1000 - Date.now() + 1000
          : 0
        const requestedWait = retryAfter
          ? Number.parseInt(retryAfter, 10) * 1000
          : Math.max(resetWait, 1000 * (2 ** attempt))
        const waitMilliseconds = Math.min(Math.max(requestedWait, 1000), 30_000)
        await delay(waitMilliseconds)
        return this.request<T>(url, attempt + 1)
      }

      const body = await response.text()
      throw new GithubApiError(
        `GitHub API ${response.status}: ${body.slice(0, 240)}`,
        response.status,
        retryAfter
      )
    }

    return response.json() as Promise<T>
  }
}
