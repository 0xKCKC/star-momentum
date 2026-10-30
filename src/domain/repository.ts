export type RepositoryCategory =
  | 'ai'
  | 'devtools'
  | 'web'
  | 'data'
  | 'security'
  | 'infra'
  | 'mobile'
  | 'desktop'
  | 'creative'
  | 'games'
  | 'learning'
  | 'other'

export interface GithubRepository {
  id: number
  nodeId: string
  name: string
  fullName: string
  owner: string
  ownerAvatarUrl: string
  url: string
  description: string
  language: string | null
  topics: string[]
  stars: number
  forks: number
  openIssues: number
  createdAt: string
  updatedAt: string
  pushedAt: string
  license: string | null
  archived: boolean
  fork: boolean
}

export interface RepositorySnapshot {
  capturedAt: string
  repositories: Array<{
    id: number
    fullName: string
    stars: number
    forks: number
    openIssues: number
    pushedAt: string
  }>
}

export interface RankingSignals {
  stars24h: number | null
  forks24h: number | null
  /** Stars per day blended from the 24h and 3-day windows; null without a baseline. */
  starVelocity?: number | null
  relativeGrowth: number | null
  acceleration7d: number | null
  /** New forks per new star over about a week; null below 200 new stars. */
  forkRatio7d?: number | null
  ageDays: number
  hoursSincePush: number
  starsPerDay: number
}

export interface ScoreBreakdown {
  starMomentum: number
  relativeGrowth: number
  acceleration: number
  forkMomentum: number
  developmentActivity: number
  freshness: number
}

export interface RepositoryResearch {
  summary: string
  whyNow: string
  bestFor: string
  evidence: string[]
  cautions: string[]
  /** 'jev' when TypeSafe's Jev model chose the categories; absent means the keyword rules. */
  categorySource?: 'jev'
  /** Risks Jev judged likely. Shown as warnings only; they never change scores or ranks. */
  risks?: RiskFlag[]
  /** Sample of the most recent stargazers, checked for fake-star account patterns. */
  starAudit?: StarAudit
  /** Most visible Hacker News story linking to the repository in the last 14 days. */
  hackerNews?: HackerNewsExposure
}

export interface RankedRepository extends GithubRepository {
  rank: number
  previousRank: number | null
  rankChange: number | null
  score: number
  categories: RepositoryCategory[]
  signals: RankingSignals
  scoreBreakdown: ScoreBreakdown
  research: RepositoryResearch
}

export interface RankingDocument {
  schemaVersion: 1
  generatedAt: string
  dataDate: string
  status: 'warmup' | 'live'
  source: 'github-live' | 'fixtures'
  methodologyVersion: string
  stats: {
    candidateCount: number
    rankedCount: number
    historyDays: number
  }
  repositories: RankedRepository[]
}

export const categoryLabels: Record<RepositoryCategory, string> = {
  ai: 'AI',
  devtools: '開發工具',
  web: 'Web',
  data: '資料',
  infra: '雲端與基建',
  security: '安全',
  mobile: '手機應用',
  desktop: '桌面與系統',
  creative: '設計與多媒體',
  games: '遊戲',
  learning: '學習資源',
  other: '其他'
}

export const repositoryCategories = Object.keys(categoryLabels) as RepositoryCategory[]

export type RiskFlag = 'piracy' | 'leaked' | 'adult' | 'crypto' | 'serviceAbuse' | 'misuse' | 'starInflation'

export interface StarAudit {
  sampled: number
  suspicious: number
  /** Hollow accounts (≤4 repositories, ≤1 follower, empty profile) created ≤30 days before starring. */
  freshHollow: number
  /** Hollow accounts that also recently starred 3+ of the same day's Top 50. */
  sharedHollow: number
  maxPerMinute: number
  flagged: boolean
}

export interface HackerNewsExposure {
  points: number
  comments: number
  postedAt: string
  url: string
}

export const riskLabels: Record<RiskFlag, string> = {
  piracy: '盜版／破解',
  leaked: '洩漏內容',
  adult: '成人內容',
  crypto: '加密貨幣推廣',
  serviceAbuse: '繞過付費服務',
  misuse: '可被濫用',
  starInflation: '疑似刷星'
}

export const riskCautions: Record<RiskFlag, string> = {
  piracy: '可能涉及破解、盜版或繞過授權，使用可能違反軟件條款或法律。',
  leaked: '可能基於洩漏或未經授權公開的程式、檔案或模型，來源和合法性存疑。',
  adult: '可能涉及成人內容，不適合在工作場所或未成年人面前瀏覽。',
  crypto: '可能在推廣特定加密貨幣或代幣，留意投資和詐騙風險。',
  serviceAbuse: '可能透過共用帳號、逆向 API 等方式繞過付費服務，或會違反服務條款並導致封號。',
  misuse: '可能是惡意程式、攻擊工具或侵犯他人私隱的工具，只應在獲授權的情況下研究使用。',
  starInflation: '近期加星帳戶中有不少資料空白的新帳戶，可能有刷星。'
}
