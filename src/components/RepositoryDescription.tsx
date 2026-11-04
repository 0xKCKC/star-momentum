import type { RankedRepository } from '../domain/repository'

interface RepositoryDescriptionProps {
  repository: RankedRepository
}

/** The Chinese introduction when there is one, otherwise the repository's own description. */
export function RepositoryDescription({ repository }: RepositoryDescriptionProps) {
  const text = repository.research.introduction?.text || repository.description || repository.research.summary
  if (!text) return null
  return (
    <p className="repository-description" lang={repository.research.introduction ? 'zh-Hant-HK' : undefined}>
      {text}
    </p>
  )
}
