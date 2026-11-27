import type { GithubRepository } from '../domain/repository'
import { GithubClient } from './github-client'

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function daysAgo(now: Date, days: number): string {
  return isoDate(new Date(now.getTime() - days * 86_400_000))
}

export function discoveryQueries(now: Date): string[] {
  const pushedRecently = `pushed:>=${daysAgo(now, 7)} archived:false stars:>=30`

  return [
    `created:>=${daysAgo(now, 7)} archived:false stars:>=3`,
    `created:>=${daysAgo(now, 30)} archived:false stars:>=10`,
    `pushed:>=${daysAgo(now, 2)} archived:false stars:>=200`,
    `topic:artificial-intelligence ${pushedRecently}`,
    `topic:developer-tools ${pushedRecently}`,
    `topic:web ${pushedRecently}`,
    `topic:data-science ${pushedRecently}`,
    `topic:security ${pushedRecently}`,
    `topic:mobile ${pushedRecently}`
  ]
}

export async function discoverRepositories(
  client: GithubClient,
  now: Date,
  onProgress?: (completed: number, total: number) => void
): Promise<GithubRepository[]> {
  const queries = discoveryQueries(now)
  const repositories = new Map<number, GithubRepository>()

  for (const [index, query] of queries.entries()) {
    const results = await client.searchRepositories(query)
    results.forEach((repository) => repositories.set(repository.id, repository))
    onProgress?.(index + 1, queries.length)
  }

  return [...repositories.values()]
}

// The search queries only see the 100 most-starred matches each, so an established mid-sized
// repository that suddenly surges is invisible to them. Repositories on GitHub Trending are
// added to the pool by name so they compete under the same scoring.
export async function addNamedRepositories(
  client: Pick<GithubClient, 'getRepository'>,
  repositories: GithubRepository[],
  fullNames: Iterable<string>,
  log: (message: string) => void = () => undefined
): Promise<GithubRepository[]> {
  const known = new Set(repositories.map(({ fullName }) => fullName.toLowerCase()))
  const missing = [...new Set([...fullNames].map((name) => name.toLowerCase()))].filter((name) => !known.has(name))
  const added: GithubRepository[] = []
  let failures = 0

  for (const name of missing) {
    try {
      const repository = await client.getRepository(name)
      if (repository && !repository.archived && !repository.fork) added.push(repository)
    } catch (error) {
      failures += 1
      if (failures === 1) log(`Trending candidate lookup failed for ${name}: ${error instanceof Error ? error.message : String(error)}`)
      if (failures >= 3) break
    }
  }

  log(`Candidate pool: added ${added.length} of ${missing.length} GitHub Trending repositories the searches missed.`)
  const ids = new Set(repositories.map(({ id }) => id))
  return [...repositories, ...added.filter(({ id }) => !ids.has(id))]
}
