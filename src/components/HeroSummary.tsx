import { Pulse, Timer } from '@phosphor-icons/react'
import type { RankingDocument } from '../domain/repository'
import { formatInteger } from '../utils/format'

interface HeroSummaryProps {
  document: RankingDocument
}

export function HeroSummary({ document }: HeroSummaryProps) {
  const isWarmup = document.status === 'warmup'

  return (
    <section className="hero" id="top">
      <div className="container hero-grid">
        <div className="hero-copy">
          <p className="hero-kicker">星勢 StarMomentum · GitHub 開源情報，每日三更</p>
          <h1>看準勢頭，發現下一顆新星。</h1>
          <p className="hero-lede">按 star 增長、加速度和開發活動，排名正在上升的開源項目。</p>
          {document.trend && (
            <div className="hero-trend" lang="zh-Hant-HK">
              <h2>今日趨勢</h2>
              <p>{document.trend.text}</p>
            </div>
          )}
        </div>
        <dl className="hero-metrics" aria-label="今日資料概況">
          <div>
            <dt>候選池</dt>
            <dd>{formatInteger(document.stats.candidateCount)}</dd>
          </div>
          <div>
            <dt>入榜</dt>
            <dd>{formatInteger(document.stats.rankedCount)}</dd>
          </div>
          <div>
            <dt>快照日數</dt>
            <dd>{document.stats.historyDays}</dd>
          </div>
          <p className="hero-note">
            {isWarmup ? <Timer size={16} aria-hidden="true" /> : <Pulse size={16} aria-hidden="true" />}
            {isWarmup ? '首日暖機中，下一次快照後顯示真實增長' : '每日增長已啟用'}
          </p>
        </dl>
        {document.source === 'fixtures' && (
          <p className="fixture-notice">目前顯示離線示例資料，執行每日抓取後會換成 GitHub 實時資料。</p>
        )}
      </div>
    </section>
  )
}
