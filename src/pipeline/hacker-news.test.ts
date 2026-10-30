// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { addHackerNewsExposure, bestStory, hackerNewsEvidence } from './hacker-news'
import { rankedRepository } from './test-repository'

const now = new Date('2026-10-30T12:00:00Z')

function hit(objectID: string, url: string, points: number, created = '2026-10-29T12:00:00Z') {
  return { objectID, url, points, num_comments: points / 2, created_at: created }
}

describe('bestStory', () => {
  it('keeps the highest-scoring story that links to the repository itself', () => {
    const story = bestStory([
      hit('1', 'https://github.com/owner/repo1', 40),
      hit('2', 'https://github.com/Owner/Repo1/tree/main/docs', 310),
      hit('3', 'https://github.com/owner/repo10', 900),
      hit('4', 'https://example.com/owner/repo1', 1000)
    ], 'owner/repo1')

    expect(story).toEqual({
      points: 310,
      comments: 155,
      postedAt: '2026-10-29T12:00:00Z',
      url: 'https://news.ycombinator.com/item?id=2'
    })
  })

  it('returns null without a matching story', () => {
    expect(bestStory([hit('1', 'https://github.com/other/repo', 50)], 'owner/repo1')).toBeNull()
  })
})

describe('addHackerNewsExposure', () => {
  it('queries recent stories and adds the exposure as evidence', async () => {
    const urls: string[] = []
    const fetchImpl = (async (input: URL | RequestInfo) => {
      urls.push(String(input))
      const hits = String(input).includes('repo1') ? [hit('9', 'https://github.com/owner/repo1', 120)] : []
      return new Response(JSON.stringify({ hits }), { status: 200 })
    }) as typeof fetch
    const [first, second] = await addHackerNewsExposure(
      [rankedRepository(1, 'One'), rankedRepository(2, 'Two')],
      { now, fetchImpl }
    )

    const query = new URL(urls[0]).searchParams
    expect(query.get('restrictSearchableAttributes')).toBe('url')
    expect(query.get('numericFilters')).toBe(`created_at_i>${now.getTime() / 1000 - 14 * 86_400}`)
    expect(first.research.hackerNews?.points).toBe(120)
    expect(first.research.evidence).toContain('Hacker News：120 分、60 則評論（24 小時前）')
    expect(second.research.hackerNews).toBeUndefined()
  })

  it('keeps going without exposure when the API is down', async () => {
    const fetchImpl = (async () => new Response('down', { status: 503 })) as typeof fetch
    const logs: string[] = []
    const [result] = await addHackerNewsExposure([rankedRepository(1, 'One')], { now, fetchImpl, log: (message) => logs.push(message) })

    expect(result.research.hackerNews).toBeUndefined()
    expect(logs.join('\n')).toContain('1 lookups failed')
  })

  it('describes older stories in days', () => {
    expect(hackerNewsEvidence({ points: 5, comments: 1, postedAt: '2026-10-25T12:00:00Z', url: '' }, now))
      .toBe('Hacker News：5 分、1 則評論（5 日前）')
  })
})
