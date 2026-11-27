import { GitFork, Star, TrendUp } from '@phosphor-icons/react'
import { periodDays, type PeriodRepository, type RankingPeriod } from '../domain/repository'
import { formatCompactNumber } from '../utils/format'
import { CategoryChips } from './CategoryChips'
import { RepositoryHeader } from './RepositoryHeader'

interface PeriodListProps {
  period: RankingPeriod
  repositories: PeriodRepository[]
}

function growthText(repository: PeriodRepository): string | null {
  if (repository.startStars <= 0) return '期內新建'
  const growth = repository.gain / repository.startStars
  if (growth < 0.01) return null
  return growth >= 10 ? `×${(growth + 1).toFixed(0)}` : `+${Math.round(growth * 100)}%`
}

export function PeriodList({ period, repositories }: PeriodListProps) {
  return (
    <div className="ranking-list" role="list" aria-label={`${periodDays[period]} 日排行`}>
      {repositories.map((repository) => {
        const growth = growthText(repository)
        return (
          <article className="ranking-row" key={repository.id} role="listitem">
            <div className="row-rank">
              <strong>#{repository.rank}</strong>
            </div>
            <div className="row-main">
              <RepositoryHeader repository={repository} />
              {(repository.introduction || repository.description) && (
                <p
                  className={repository.introduction ? 'repository-description is-introduction' : 'repository-description'}
                  lang={repository.introduction ? 'zh-Hant-HK' : undefined}
                >
                  {repository.introduction || repository.description}
                </p>
              )}
            </div>
            <div className="row-side">
              <div className="repo-meta">
                <span title="總 stars"><Star size={16} weight="fill" />{formatCompactNumber(repository.stars)}</span>
                <span title="總 forks"><GitFork size={16} />{formatCompactNumber(repository.forks)}</span>
                <span className="momentum" title={`${periodDays[period]} 日新增 stars`}>
                  <TrendUp size={16} />+{formatCompactNumber(repository.gain)}/{periodDays[period]}日
                </span>
                {growth && <span className="chart-badge" title="相對期初的 stars 增幅">{growth}</span>}
                {repository.todayRank !== null && (
                  <span className="trending-badge" title="同時在今日榜上">今日 #{repository.todayRank}</span>
                )}
              </div>
              <CategoryChips categories={repository.categories} />
            </div>
          </article>
        )
      })}
    </div>
  )
}
