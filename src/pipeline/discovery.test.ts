// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { GithubRepository } from '../domain/repository'
import { addNamedRepositories } from './discovery'
import { rankedRepository } from './test-repository'

function candidate(id: number, overrides: Partial<GithubRepository> = {}): GithubRepository {
  return { ...rankedRepository(id, ''), ...overrides }
}

describe('addNamedRepositories', () => {
  it('fetches only the names the searches missed and skips archived, forked or deleted ones', async () => {
    const byName: Record<string, GithubRepository | null> = {
      'new/surge': candidate(7, { fullName: 'new/surge' }),
      'old/archived': candidate(8, { fullName: 'old/archived', archived: true }),
      'gone/repo': null
    }
    const getRepository = vi.fn(async (name: string) => byName[name])

    const pool = await addNamedRepositories({ getRepository }, [candidate(1)], ['Owner/Repo1', 'new/surge', 'old/archived', 'gone/repo', 'new/surge'])

    expect(getRepository.mock.calls.map(([name]) => name)).toEqual(['new/surge', 'old/archived', 'gone/repo'])
    expect(pool.map(({ fullName }) => fullName)).toEqual(['owner/repo1', 'new/surge'])
  })

  it('keeps the pool when lookups keep failing', async () => {
    const getRepository = vi.fn(async () => { throw new Error('boom') })

    const pool = await addNamedRepositories({ getRepository }, [candidate(1)], ['a/b', 'c/d', 'e/f', 'g/h'])

    expect(pool).toHaveLength(1)
    expect(getRepository).toHaveBeenCalledTimes(3)
  })
})
