import type { RankedRepository } from '../domain/repository'

// Fetches README files once per run so the Jev ease judgment and the DeepSeek introductions
// read the same text. A missing or unreadable README comes back as an empty string.

type Fetch = typeof fetch

const README_CHARS = 12000
const CONCURRENCY = 5

/** Plain-text README excerpt: drops HTML, images, badges, link targets and code blocks. */
export function readmeExcerpt(markdown: string, maxChars = README_CHARS): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, maxChars)
}

export async function fetchReadme(fetchImpl: Fetch, fullName: string, token?: string): Promise<string> {
  try {
    const response = await fetchImpl(`https://api.github.com/repos/${fullName}/readme`, {
      headers: {
        Accept: 'application/vnd.github.raw+json',
        'User-Agent': 'star-momentum',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      signal: AbortSignal.timeout(20_000)
    })
    return response.ok ? readmeExcerpt(await response.text()) : ''
  } catch {
    return ''
  }
}

export async function fetchReadmes(
  repositories: RankedRepository[],
  options: { token?: string, fetchImpl?: Fetch, log?: (message: string) => void } = {}
): Promise<Map<number, string>> {
  const fetchImpl = options.fetchImpl ?? fetch
  const readmes = new Map<number, string>()
  const queue = [...repositories]
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let repository = queue.shift(); repository; repository = queue.shift()) {
      readmes.set(repository.id, await fetchReadme(fetchImpl, repository.fullName, options.token))
    }
  }))
  const found = [...readmes.values()].filter((text) => text.length >= 80).length
  options.log?.(`READMEs: ${found}/${repositories.length} readable.`)
  return readmes
}
