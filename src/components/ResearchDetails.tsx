import { CaretDown, CheckCircle, Warning } from '@phosphor-icons/react'
import { categoryLabels, type RankedRepository } from '../domain/repository'

interface ResearchDetailsProps {
  repository: RankedRepository
}

export function ResearchDetails({ repository }: ResearchDetailsProps) {
  return (
    <details className="research-details">
      <summary>研究摘要 <CaretDown size={16} aria-hidden="true" /></summary>
      <div className="research-content">
        <div className="research-main">
          <h4>適合誰</h4>
          <p>{repository.research.bestFor}</p>
        </div>
        <div className="research-evidence">
          <h4>可核對資料</h4>
          <ul>
            {repository.research.evidence.map((item) => (
              <li key={item}><CheckCircle size={16} aria-hidden="true" />{item}</li>
            ))}
          </ul>
        </div>
        <div className="research-cautions">
          <h4>採用前注意</h4>
          {repository.research.cautions.map((caution, index) => (
            <p key={caution} className={index < (repository.research.risks?.length ?? 0) ? 'is-risk' : undefined}>
              <Warning size={16} aria-hidden="true" />{caution}
            </p>
          ))}
        </div>
        <div className="score-breakdown" aria-label="分數拆解">
          <span>star 動能 <strong>{repository.scoreBreakdown.starMomentum.toFixed(1)}</strong></span>
          <span>相對增長 <strong>{repository.scoreBreakdown.relativeGrowth.toFixed(1)}</strong></span>
          <span>加速度 <strong>{repository.scoreBreakdown.acceleration.toFixed(1)}</strong></span>
          <span>fork 動能 <strong>{repository.scoreBreakdown.forkMomentum.toFixed(1)}</strong></span>
          <span>開發活動 <strong>{repository.scoreBreakdown.developmentActivity.toFixed(1)}</strong></span>
          <span>新鮮度 <strong>{repository.scoreBreakdown.freshness.toFixed(1)}</strong></span>
        </div>
        <p className="research-categories">
          {repository.categories.map((category) => categoryLabels[category]).join(' / ')}
        </p>
        {repository.research.introduction && repository.description && (
          <p className="research-original"><span>原文簡介</span>{repository.description}</p>
        )}
        {repository.research.introduction && (
          <p className="research-ai-note">中文介紹由 DeepSeek 根據項目描述和 README 撰寫，可能有誤，請以原文為準。</p>
        )}
        {repository.research.categorySource === 'jev' && (
          <p className="research-ai-note">分類和風險提示由 Jev 模型根據 repo 描述判斷，只作參考，不影響排名。</p>
        )}
      </div>
    </details>
  )
}
