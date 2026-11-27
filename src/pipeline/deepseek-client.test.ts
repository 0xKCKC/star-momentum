// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { chat, deepSeekUsage } from './deepseek-client'

describe('deepSeekUsage', () => {
  it('adds up the tokens DeepSeek reports for each call', async () => {
    const before = deepSeekUsage()
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1200, completion_tokens: 300 }
    })))

    await chat({ apiKey: 'key', fetchImpl }, [{ role: 'user', content: 'hi' }], 100)
    await chat({ apiKey: 'key', fetchImpl }, [{ role: 'user', content: 'hi' }], 100)

    const after = deepSeekUsage()
    expect(after.calls - before.calls).toBe(2)
    expect(after.promptTokens - before.promptTokens).toBe(2400)
    expect(after.completionTokens - before.completionTokens).toBe(600)
  })
})
