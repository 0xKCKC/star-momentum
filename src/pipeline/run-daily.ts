import { resolve } from 'node:path'
import { scoreRepositories } from '../domain/scoring'
import type { GithubRepository, RankingDocument, RepositorySnapshot } from '../domain/repository'
import { addNamedRepositories, discoverRepositories } from './discovery'
import { fixtureRepositories } from './fixtures'
import { GithubClient } from './github-client'
import { addChartHistory, loadChartDays } from './chart-history'
import { deepSeekUsage } from './deepseek-client'
import { addDeepSeekIntroductions } from './deepseek-intro'
import { addGithubTrending, fetchTrendingNames } from './github-trending'
import { addHackerNewsExposure } from './hacker-news'
import { addEaseLabels } from './jev-ease'
import { fetchReadmes } from './readme'
import { writeTrendSummary } from './trend-summary'
import { researchWithJev } from './jev-research'
import { buildMarkdownReport } from './report'
import { auditTopStargazers } from './star-audit'
import { buildPeriodRanking } from './period-rankings'
import { loadCurrentRanking, loadSnapshotHistory, saveDailyOutputs, savePeriodRanking } from './storage'

async function run(): Promise<void> {
  const root = resolve(process.cwd())
  const now = new Date()
  const nowIso = now.toISOString()
  const dataDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now)
  const useFixtures = process.argv.includes('--fixtures')
  const previousDocument = await loadCurrentRanking(root)
  const history = await loadSnapshotHistory(root, dataDate)

  const log = (message: string) => process.stdout.write(`${message}\n`)
  const trending = useFixtures || process.env.GITHUB_TRENDING === 'off' ? null : await fetchTrendingNames({ log })
  let repositories: GithubRepository[]
  if (useFixtures) {
    repositories = fixtureRepositories(now)
  } else {
    const client = new GithubClient()
    repositories = await discoverRepositories(client, now, (completed, total) => log(`GitHub discovery ${completed}/${total}`))
    if (trending) {
      repositories = await addNamedRepositories(client, repositories, [...trending.daily, ...trending.weekly], log)
    }
  }

  if (repositories.length < 5) {
    throw new Error(`Candidate pool too small: ${repositories.length}`)
  }

  const ranked = scoreRepositories(repositories, {
    now: nowIso,
    history,
    previousRanking: previousDocument?.repositories
  }).slice(0, 50)
  // Each step only adds research and warnings; scores and ranks are already final.
  let researched = ranked
  if (!useFixtures && process.env.JEV !== 'off') {
    researched = await researchWithJev(researched, { apiKey: process.env.TYPESAFE_API_KEY, log })
  }
  const readmes = useFixtures ? new Map<number, string>() : await fetchReadmes(researched, { token: process.env.GITHUB_TOKEN, log })
  if (!useFixtures && process.env.JEV !== 'off') {
    researched = await addEaseLabels(researched, {
      apiKey: process.env.TYPESAFE_API_KEY,
      readmes,
      now,
      previous: previousDocument?.repositories,
      log
    })
  }
  if (!useFixtures && process.env.STAR_AUDIT !== 'off') {
    // The workflow's GITHUB_TOKEN cannot read other repositories' stargazers through GraphQL
    // ("Resource not accessible by integration"), so this needs a read-only personal token.
    researched = await auditTopStargazers(researched, { token: process.env.STAR_AUDIT_TOKEN || process.env.GITHUB_TOKEN, log })
  }
  if (!useFixtures && process.env.HACKER_NEWS !== 'off') {
    researched = await addHackerNewsExposure(researched, { now, log })
  }
  if (!useFixtures && process.env.DEEPSEEK !== 'off') {
    researched = await addDeepSeekIntroductions(researched, {
      apiKey: process.env.DEEPSEEK_API_KEY,
      githubToken: process.env.GITHUB_TOKEN,
      model: process.env.DEEPSEEK_MODEL,
      now,
      previous: previousDocument?.repositories,
      readmes,
      log
    })
  }
  const trend = !useFixtures && process.env.DEEPSEEK !== 'off'
    ? await writeTrendSummary(researched, { apiKey: process.env.DEEPSEEK_API_KEY, model: process.env.DEEPSEEK_MODEL, now, log })
    : undefined
  const deepseek = deepSeekUsage()
  if (deepseek.calls > 0) {
    log(`DeepSeek usage this update: ${deepseek.calls} calls, ${deepseek.promptTokens} input + ${deepseek.completionTokens} output = ${deepseek.promptTokens + deepseek.completionTokens} tokens.`)
  }
  // Last, because earlier steps rebuild the research object.
  let githubTrending: RankingDocument['githubTrending']
  if (!useFixtures) {
    const chartDays = await loadChartDays(root, dataDate)
    researched = addChartHistory(researched, chartDays, dataDate)
    if (trending) {
      const compared = addGithubTrending(researched, { now, today: dataDate, days: chartDays, previous: previousDocument, listed: trending.daily, log })
      researched = compared.repositories
      githubTrending = compared.comparison
    }
  }
  const snapshot: RepositorySnapshot = {
    capturedAt: nowIso,
    repositories: repositories.map((repository) => ({
      id: repository.id,
      fullName: repository.fullName,
      stars: repository.stars,
      forks: repository.forks,
      openIssues: repository.openIssues,
      pushedAt: repository.pushedAt
    }))
  }
  const document: RankingDocument = {
    schemaVersion: 1,
    generatedAt: nowIso,
    dataDate,
    status: history.length > 0 ? 'live' : 'warmup',
    source: useFixtures ? 'fixtures' : 'github-live',
    methodologyVersion: '1.2.0',
    stats: {
      candidateCount: repositories.length,
      rankedCount: researched.length,
      historyDays: history.length + 1
    },
    ...(trend ? { trend } : {}),
    ...(deepseek.calls > 0 ? { deepseekUsage: deepseek } : {}),
    ...(githubTrending ? { githubTrending } : {}),
    repositories: researched
  }

  await saveDailyOutputs(root, document, snapshot, buildMarkdownReport(document))
  if (!useFixtures) {
    const periodSnapshots = await loadSnapshotHistory(root, dataDate, 40)
    for (const period of ['week', 'month'] as const) {
      const ranking = buildPeriodRanking(repositories, { now: nowIso, dataDate, period, snapshots: periodSnapshots, ranked: researched })
      await savePeriodRanking(root, ranking)
      log(`${period} chart: ${ranking.repositories.length} repositories from ${ranking.candidateCount} with a baseline.`)
    }
  }
  process.stdout.write(`Saved ${researched.length} ranked repositories from ${repositories.length} candidates.\n`)
}

run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
