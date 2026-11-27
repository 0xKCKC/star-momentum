import type { RankingPeriod } from '../domain/repository'

export type ChartView = 'today' | RankingPeriod

export const chartViewLabels: Record<ChartView, string> = {
  today: '今日',
  week: '7 日',
  month: '30 日'
}

const views: ChartView[] = ['today', 'week', 'month']

interface PeriodTabsProps {
  view: ChartView
  onViewChange: (view: ChartView) => void
}

export function PeriodTabs({ view, onViewChange }: PeriodTabsProps) {
  return (
    <div className="period-tabs" role="group" aria-label="排行時段">
      {views.map((item) => (
        <button
          className={item === view ? 'period-tab is-active' : 'period-tab'}
          key={item}
          onClick={() => onViewChange(item)}
          type="button"
          aria-pressed={item === view}
        >
          {chartViewLabels[item]}
        </button>
      ))}
    </div>
  )
}
