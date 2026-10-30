import { resolve } from 'node:path'
import { scoreRepositories } from '../domain/scoring'
import type { RankingDocument, RepositorySnapshot } from '../domain/repository'
import { discoverRepositories } from './discovery'
import { fixtureRepositories } from './fixtures'
import { GithubClient } from './github-client'
import { addHackerNewsExposure } from './hacker-news'
import { researchWithJev } from './jev-research'
import { buildMarkdownReport } from './report'
import { auditTopStargazers } from './star-audit'
import { loadCurrentRanking, loadSnapshotHistory, saveDailyOutputs } from './storage'

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

  const repositories = useFixtures
    ? fixtureRepositories(now)
    : await discoverRepositories(new GithubClient(), now, (completed, total) => {
      process.stdout.write(`GitHub discovery ${completed}/${total}\n`)
    })

  if (repositories.length < 5) {
    throw new Error(`Candidate pool too small: ${repositories.length}`)
  }

  const ranked = scoreRepositories(repositories, {
    now: nowIso,
    history,
    previousRanking: previousDocument?.repositories
  }).slice(0, 50)
  const log = (message: string) => process.stdout.write(`${message}\n`)
  // Each step only adds research and warnings; scores and ranks are already final.
  let researched = ranked
  if (!useFixtures && process.env.JEV !== 'off') {
    researched = await researchWithJev(researched, { apiKey: process.env.TYPESAFE_API_KEY, log })
  }
  if (!useFixtures && process.env.STAR_AUDIT !== 'off') {
    // The workflow's GITHUB_TOKEN cannot read other repositories' stargazers through GraphQL
    // ("Resource not accessible by integration"), so this needs a read-only personal token.
    researched = await auditTopStargazers(researched, { token: process.env.STAR_AUDIT_TOKEN, log })
  }
  if (!useFixtures && process.env.HACKER_NEWS !== 'off') {
    researched = await addHackerNewsExposure(researched, { now, log })
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
    repositories: researched
  }

  await saveDailyOutputs(root, document, snapshot, buildMarkdownReport(document))
  process.stdout.write(`Saved ${researched.length} ranked repositories from ${repositories.length} candidates.\n`)
}

run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  process.exitCode = 1
})
