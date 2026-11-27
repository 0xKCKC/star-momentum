import { useEffect, useState } from 'react'
import type { PeriodRanking, RankingPeriod } from '../domain/repository'

interface PeriodRankingState {
  data: PeriodRanking | null
  loading: boolean
  /** True when the chart has not been generated yet or could not be read. */
  unavailable: boolean
}

/** Loads the week or month chart the first time its tab is opened. */
export function usePeriodRanking(period: RankingPeriod | null): PeriodRankingState {
  const [cache, setCache] = useState<Partial<Record<RankingPeriod, PeriodRanking | 'unavailable'>>>({})

  useEffect(() => {
    if (!period || cache[period]) return
    const controller = new AbortController()

    fetch(`${import.meta.env.BASE_URL}data/${period}.json`, { signal: controller.signal, cache: 'no-cache' })
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status))
        return response.json() as Promise<PeriodRanking>
      })
      .then((data) => setCache((current) => ({ ...current, [period]: data })))
      .catch(() => {
        if (!controller.signal.aborted) setCache((current) => ({ ...current, [period]: 'unavailable' }))
      })

    return () => controller.abort()
  }, [period, cache])

  const entry = period ? cache[period] : undefined
  return {
    data: entry && entry !== 'unavailable' ? entry : null,
    loading: period !== null && entry === undefined,
    unavailable: entry === 'unavailable'
  }
}
