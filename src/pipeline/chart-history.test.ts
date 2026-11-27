// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { addChartHistory, type ChartDay } from './chart-history'
import { rankedRepository } from './test-repository'

function day(date: string, ranks: Record<number, number>): ChartDay {
  return { date, repositories: Object.entries(ranks).map(([id, rank]) => ({ id: Number(id), rank })) }
}

describe('addChartHistory', () => {
  const days = [
    day('2026-11-01', { 1: 9 }),
    day('2026-11-02', { 2: 4 }),
    day('2026-11-03', { 1: 2, 2: 6 }),
    day('2026-11-04', { 1: 5 }),
    day('2026-11-05', { 1: 1, 3: 3 })
  ]

  it('records first entry, total days, current streak and best rank', () => {
    const [first, second, third] = addChartHistory(
      [rankedRepository(1, ''), rankedRepository(2, ''), rankedRepository(3, '')],
      days,
      '2026-11-05'
    )

    expect(first.research.chart).toEqual({ firstSeen: '2026-11-01', days: 4, streak: 3, bestRank: 1 })
    expect(second.research.chart).toEqual({ firstSeen: '2026-11-02', days: 3, streak: 1, bestRank: 2 })
    expect(third.research.chart).toEqual({ firstSeen: '2026-11-05', days: 1, streak: 1, bestRank: 3 })
    expect(third.research.evidence).toContain('本榜紀錄：今日首次上榜')
  })

  it('ignores a stored copy of today so reruns do not double count', () => {
    const [repository] = addChartHistory([rankedRepository(3, '')], days, '2026-11-05')

    expect(repository.research.chart?.days).toBe(1)
  })
})
