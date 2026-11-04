import type { RankedRepository } from '../domain/repository'
import { CategoryChips } from './CategoryChips'
import { RepositoryDescription } from './RepositoryDescription'
import { RepositoryHeader } from './RepositoryHeader'
import { RepositoryMeta } from './RepositoryMeta'
import { ResearchDetails } from './ResearchDetails'

interface RankingListProps {
  repositories: RankedRepository[]
}

export function RankingList({ repositories }: RankingListProps) {
  if (repositories.length === 0) return null

  return (
    <div className="ranking-list" role="list" aria-label="其餘排名">
      {repositories.map((repository) => (
        <article className="ranking-row" key={repository.id} role="listitem">
          <div className="row-rank">
            <strong>#{repository.rank}</strong>
            <span>{repository.score.toFixed(1)}</span>
          </div>
          <div className="row-main">
            <RepositoryHeader repository={repository} />
            <RepositoryDescription repository={repository} />
          </div>
          <div className="row-side">
            <RepositoryMeta repository={repository} />
            <CategoryChips categories={repository.categories} />
          </div>
          <ResearchDetails repository={repository} />
        </article>
      ))}
    </div>
  )
}
