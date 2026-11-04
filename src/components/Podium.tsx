import type { RankedRepository } from '../domain/repository'
import { formatAge } from '../utils/format'
import { CategoryChips } from './CategoryChips'
import { RepositoryDescription } from './RepositoryDescription'
import { RepositoryHeader } from './RepositoryHeader'
import { RepositoryMeta } from './RepositoryMeta'
import { ResearchDetails } from './ResearchDetails'

interface PodiumProps {
  repositories: RankedRepository[]
}

export function Podium({ repositories }: PodiumProps) {
  if (repositories.length === 0) return null

  return (
    <div className="podium" role="list" aria-label="前三名">
      {repositories.map((repository, index) => (
        <article className={index === 0 ? 'podium-card is-first' : 'podium-card'} key={repository.id} role="listitem">
          <div className="rank-score">
            <span className="rank-number">#{repository.rank}</span>
            <span className="score-number">{repository.score.toFixed(1)} 分</span>
          </div>
          <RepositoryHeader repository={repository} />
          <RepositoryDescription repository={repository} />
          <CategoryChips categories={repository.categories} />
          <RepositoryMeta repository={repository} />
          <p className="repository-age">{formatAge(repository.signals.ageDays)}</p>
          <ResearchDetails repository={repository} />
        </article>
      ))}
    </div>
  )
}
