// @vitest-environment node
import { TypeSafeClient } from '@typesafe-ai/sdk'
import { describe, expect, it } from 'vitest'
import { addEaseLabels, setupExcerpt } from './jev-ease'
import { rankedRepository } from './test-repository'

const now = new Date('2026-11-06T08:00:00Z')
const readme = '# Tool\nA desktop app that cleans up your TV.\n## Features\nMany.\n## Download\nGet the installer from Releases.\n## Build\nnpm run build'

function clientChoosing(level: string) {
  const states: unknown[] = []
  const client = new TypeSafeClient({
    apiKey: 'test-key',
    logLevel: 'off',
    retry: { maxRetries: 0 },
    fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      states.push(body.state)
      return new Response(JSON.stringify({
        model: 'jev-1',
        usage: { input_tokens: 100, output_tokens: 1 },
        answers: { ease: { type: 'choice', choice: level, confidence: 0.8, probabilities: { [level]: 0.8 } } }
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
  })
  return { client, states }
}

describe('setupExcerpt', () => {
  it('keeps the opening and the download section', () => {
    const long = `# Tool\n${'Intro text. '.repeat(200)}\n## Download\nGet the installer from Releases.`
    const excerpt = setupExcerpt(long)
    expect(excerpt.startsWith('# Tool')).toBe(true)
    expect(excerpt).toContain('Get the installer from Releases.')
    expect(excerpt.length).toBeLessThan(long.length)
  })
})

describe('addEaseLabels', () => {
  it('labels repositories with a README and skips those without one', async () => {
    const { client, states } = clientChoosing('ready')
    const repositories = [rankedRepository(1, 'TV cleaner'), rankedRepository(2, 'No readme')]
    const [labelled, skipped] = await addEaseLabels(repositories, {
      client,
      readmes: new Map([[1, readme], [2, '']]),
      now
    })

    expect(labelled.research.ease).toEqual({ level: 'ready', judgedAt: now.toISOString() })
    expect(skipped.research.ease).toBeUndefined()
    expect(JSON.stringify(states[0])).toContain('Get the installer from Releases.')
  })

  it('reuses a recent label while the description is unchanged', async () => {
    const { client, states } = clientChoosing('code')
    const earlier = {
      ...rankedRepository(1, 'Same'),
      research: { ...rankedRepository(1, 'Same').research, ease: { level: 'cli' as const, judgedAt: '2026-11-05T08:00:00Z' } }
    }
    const [result] = await addEaseLabels([rankedRepository(1, 'Same')], {
      client, readmes: new Map([[1, readme]]), now, previous: [earlier]
    })
    expect(result.research.ease?.level).toBe('cli')
    expect(states).toHaveLength(0)
  })

  it('ignores an unknown choice and skips without a key', async () => {
    const { client } = clientChoosing('something-else')
    const [result] = await addEaseLabels([rankedRepository(1, 'Tool')], { client, readmes: new Map([[1, readme]]), now })
    expect(result.research.ease).toBeUndefined()

    const input = [rankedRepository(1, 'Tool')]
    expect(await addEaseLabels(input, { readmes: new Map(), now })).toBe(input)
  })
})
