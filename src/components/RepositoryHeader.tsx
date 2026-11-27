import { ArrowSquareOut } from '@phosphor-icons/react'
import { useState } from 'react'
import type { RankedRepository } from '../domain/repository'

interface RepositoryHeaderProps {
  repository: Pick<RankedRepository, 'owner' | 'ownerAvatarUrl' | 'url' | 'fullName' | 'language' | 'license'>
}

export function RepositoryHeader({ repository }: RepositoryHeaderProps) {
  const [avatarFailed, setAvatarFailed] = useState(!repository.ownerAvatarUrl)

  return (
    <div className="repository-heading">
      {avatarFailed ? (
        <span className="avatar-fallback" aria-hidden="true">{repository.owner.slice(0, 1).toUpperCase()}</span>
      ) : (
        <img
          src={repository.ownerAvatarUrl}
          width="40"
          height="40"
          alt=""
          loading="lazy"
          onError={() => setAvatarFailed(true)}
        />
      )}
      <div>
        <a href={repository.url} target="_blank" rel="noreferrer">
          {repository.fullName}
          <ArrowSquareOut size={16} aria-hidden="true" />
        </a>
        <p>{repository.language ?? '未識別語言'} {repository.license ? `/ ${repository.license}` : '/ 未標示授權'}</p>
      </div>
    </div>
  )
}
