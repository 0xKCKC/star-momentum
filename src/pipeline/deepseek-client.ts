// Minimal DeepSeek chat client shared by the introductions and the daily trend summary.

type Fetch = typeof fetch

// DeepSeek's official name for DeepSeek-V4.1-Flash-1017.
export const DEFAULT_MODEL = 'deepseek-flash'

export interface DeepSeekSettings {
  apiKey: string
  model?: string
  fetchImpl?: Fetch
}

export interface ChatMessage { role: string, content: string }

export interface Completion { content: string, finishReason: string }

export async function chat(settings: DeepSeekSettings, messages: ChatMessage[], maxTokens: number): Promise<Completion> {
  const fetchImpl = settings.fetchImpl ?? fetch
  const response = await fetchImpl('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.model || DEFAULT_MODEL,
      temperature: 0.3,
      max_tokens: maxTokens,
      messages
    }),
    signal: AbortSignal.timeout(180_000)
  })
  if (!response.ok) throw new Error(`DeepSeek ${response.status}: ${(await response.text()).slice(0, 160)}`)
  const body = await response.json() as { choices?: Array<{ message?: { content?: string | null }, finish_reason?: string }> }
  const choice = body.choices?.[0]
  return { content: choice?.message?.content ?? '', finishReason: choice?.finish_reason ?? 'unknown' }
}
