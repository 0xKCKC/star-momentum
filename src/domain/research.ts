import { categoryLabels, type GithubRepository, type RankingSignals, type RepositoryCategory, type RepositoryResearch } from './repository'

const bestForByCategory: Record<RepositoryCategory, string> = {
  ai: '想試驗 AI 模型、代理或生成式工作流的開發者',
  devtools: '希望改善開發、測試或部署流程的工程團隊',
  web: '建立網站、服務或前端產品的開發者',
  data: '處理資料管線、分析、儲存或視覺化的團隊',
  infra: '負責部署、伺服器、網絡或自託管服務的工程師',
  security: '負責程式安全、審計或防禦工作的工程師',
  mobile: '使用或開發 iOS、Android 應用的人',
  desktop: '想改善 macOS、Windows 或 Linux 使用體驗的用戶',
  creative: '處理圖片、影片、音樂或設計工作的創作者',
  games: '玩家、遊戲開發者和 mod 作者',
  learning: '想系統學習或查找參考資料的人',
  other: '正在尋找新開源工具和技術方向的開發者'
}

function momentumText(repository: GithubRepository, signals: RankingSignals): string {
  if (signals.stars24h !== null) {
    const forkText = signals.forks24h && signals.forks24h > 0
      ? `，同時增加 ${signals.forks24h.toLocaleString('zh-HK')} 個 forks`
      : ''
    return `過去 24 小時增加 ${signals.stars24h.toLocaleString('zh-HK')} 個 stars${forkText}，數據動能令它進入今日榜。`
  }

  const ageText = signals.ageDays < 30
    ? `建立約 ${Math.max(1, Math.round(signals.ageDays))} 日`
    : '目前仍在建立排名基線'
  return `${ageText}，平均每日累積約 ${signals.starsPerDay.toFixed(1)} 個 stars。明日快照後會改用真實 24 小時增量。`
}

export const FORK_SHARE_CAUTION_PREFIX = '近 7 日新增 forks '
export const DEFAULT_CAUTION = '熱門度不等於適合生產環境，採用前仍要檢查文件、測試和安全紀錄。'

function cautionText(repository: GithubRepository, signals: RankingSignals): string[] {
  const cautions: string[] = []

  if (!repository.license) {
    cautions.push('GitHub 未標示開源授權，正式採用前要先確認使用條款。')
  }
  if (signals.ageDays < 30) {
    cautions.push('項目仍然很新，API、文件和維護節奏可能快速改變。')
  }
  if (signals.hoursSincePush > 24 * 30) {
    cautions.push('超過 30 日未見 push，採用前要確認維護狀態。')
  }
  if (repository.openIssues > Math.max(100, repository.stars * 0.08)) {
    cautions.push('未處理 issues 相對較多，要留意支援能力和成熟度。')
  }
  if (signals.forkRatio7d != null && signals.forkRatio7d < 0.03) {
    const share = (signals.forkRatio7d * 100).toFixed(1)
    cautions.push(`${FORK_SHARE_CAUTION_PREFIX}只有新增 stars 的 ${share}%（一般約 10%），可能是收藏型清單，亦可能有刷星，宜先核實 stargazers。`)
  }

  return cautions.length > 0 ? cautions : [DEFAULT_CAUTION]
}

export function buildResearch(
  repository: GithubRepository,
  signals: RankingSignals,
  categories: RepositoryCategory[]
): RepositoryResearch {
  const primaryCategory = categories[0] ?? 'other'
  const summary = repository.description || `${repository.fullName} 是一個以 ${repository.language ?? '多種技術'} 建立的公開 GitHub 項目。`
  const evidence = [
    `${repository.stars.toLocaleString('zh-HK')} stars，${repository.forks.toLocaleString('zh-HK')} forks`,
    repository.language ? `主要語言：${repository.language}` : 'GitHub 尚未識別主要語言',
    repository.license ? `授權：${repository.license}` : '授權：未標示',
    `分類：${categories.map((category) => categoryLabels[category]).join('、')}`
  ]

  return {
    summary,
    whyNow: momentumText(repository, signals),
    bestFor: bestForByCategory[primaryCategory],
    evidence,
    cautions: cautionText(repository, signals)
  }
}
