import { choice, noul, TypeSafeClient, APIError } from '@typesafe-ai/sdk'
import { easeLevels, type EaseLevel, type RankedRepository, type RepositoryEase } from '../domain/repository'

// Asks TypeSafe's Jev model how someone starts using each Top 50 repository, judged from its
// README: download and run, run commands, or write code. The label helps non-programmers find
// tools they can use. A recent label is reused while the description is unchanged, so labels
// do not flip between runs. Any failure leaves the repository unlabelled; nothing here changes
// scores or ranks.

const CONCURRENCY = 5
const REUSE_DAYS = 3
const DAY = 86_400_000
const HEAD_CHARS = 1500
const SECTION_CHARS = 2500
const MIN_README_CHARS = 80
/** Bump when the questions change so cached labels are judged again. */
const EASE_VERSION = 2
/** "ready" also needs this yes-probability that a non-programmer can start by downloading and clicking. */
const READY_MIN_YES = 0.6

const easeCriteria: Record<EaseLevel, string> = {
  ready: 'A graphical app, installer, app store listing, browser extension or website that an ordinary user opens and uses by clicking, with no terminal and no config files',
  cli: 'Getting started means typing terminal commands, editing config files, or installing it into another tool, for example a command-line program (even with prebuilt binaries), a script, Docker, adb, a plugin, an AI agent skill or an MCP server',
  code: 'It is a library, SDK, framework, model, dataset or research code that people build on, or using it requires writing code, setting up a development environment, or assembling and flashing hardware',
  reading: 'It is not software to run but material to read, such as a guide, tutorial, book or list of links'
}

const easeQuestion = choice(
  {
    task: 'Judging by `repository` and its README excerpt, what does someone need to do to start using it?',
    rules: [
      'Judge the easiest official way to get started that the README describes.',
      'A downloadable graphical app counts as ready even if building from source is also described; a downloadable command-line binary does not.',
      'Plugins, extensions or skills for developer tools, AI agents or other host programs are cli, not ready.',
      'Choose code when the main audience is developers who integrate or extend it.'
    ]
  },
  easeCriteria
)

const clickOnlyQuestion = noul(
  'Could someone who has never used a terminal start using `repository` just by downloading or opening it and clicking, as the README describes, without typing commands, editing config files or installing other developer tools first?',
  {
    true: 'Yes: there is a ready-made app, installer, store listing, browser extension or website',
    false: 'No: it needs commands, config files, a host tool such as an AI agent or IDE, programming or hardware'
  }
)

export function easeFromAnswers(selected: string | undefined, clickOnlyYes: number): EaseLevel | null {
  if (!easeLevels.includes(selected as EaseLevel)) return null
  const level = selected as EaseLevel
  return level === 'ready' && clickOnlyYes < READY_MIN_YES ? 'cli' : level
}

/** The README's opening plus the sections about installing or getting started. */
export function setupExcerpt(readme: string): string {
  const head = readme.slice(0, HEAD_CHARS)
  const lines = readme.split('\n')
  const setup: string[] = []
  let inSetup = false
  for (const line of lines) {
    if (/^#{1,4}\s/.test(line)) {
      inSetup = /install|download|getting started|quick ?start|usage|setup|安裝|下載|使用|快速開始|開始/i.test(line)
    }
    if (inSetup) setup.push(line)
  }
  const sections = setup.join('\n').slice(0, SECTION_CHARS)
  return sections && !head.includes(sections.slice(0, 200)) ? `${head}\n…\n${sections}` : head
}

interface JevClient {
  systemOne: TypeSafeClient['systemOne']
}

interface EaseOptions {
  apiKey?: string
  client?: JevClient
  readmes: Map<number, string>
  now: Date
  previous?: RankedRepository[]
  log?: (message: string) => void
}

async function judgeEase(client: JevClient, repository: RankedRepository, readme: string): Promise<EaseLevel | null> {
  const { answers } = await client.systemOne({
    state: {
      repository: {
        name: repository.fullName,
        description: repository.description.slice(0, 500),
        readme: setupExcerpt(readme)
      }
    },
    questions: { ease: easeQuestion, clickOnly: clickOnlyQuestion }
  })
  return easeFromAnswers(answers.ease?.choice, answers.clickOnly?.noul ?? 0)
}

export async function addEaseLabels(repositories: RankedRepository[], options: EaseOptions): Promise<RankedRepository[]> {
  const log = options.log ?? (() => undefined)
  if (!options.client && !options.apiKey) {
    log('Jev ease skipped: no TYPESAFE_API_KEY.')
    return repositories
  }
  const client = options.client ?? new TypeSafeClient({ apiKey: options.apiKey, timeout: 15_000, logLevel: 'off' })
  const nowIso = options.now.toISOString()

  const previous = new Map((options.previous ?? []).map((repository) => [repository.id, repository]))
  const labels = new Map<number, RepositoryEase>()
  const pending: RankedRepository[] = []
  for (const repository of repositories) {
    const earlier = previous.get(repository.id)
    const ease = earlier?.research.ease
    if (ease && ease.version === EASE_VERSION && earlier.description === repository.description &&
      options.now.getTime() - Date.parse(ease.judgedAt) < REUSE_DAYS * DAY) {
      labels.set(repository.id, ease)
    } else if ((options.readmes.get(repository.id) ?? '').length >= MIN_README_CHARS) {
      pending.push(repository)
    }
  }
  const reused = labels.size

  let failures = 0
  let stopped = false
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (!stopped) {
      const repository = pending.shift()
      if (!repository) return
      try {
        const level = await judgeEase(client, repository, options.readmes.get(repository.id)!)
        if (level) labels.set(repository.id, { level, judgedAt: nowIso, version: EASE_VERSION })
      } catch (error) {
        failures += 1
        if (failures <= 3) log(`Jev ease failed for ${repository.fullName}: ${error instanceof Error ? error.message : String(error)}`)
        if (error instanceof APIError && [400, 401, 403, 404, 422].includes(error.status)) stopped = true
      }
    }
  }))

  const counts = Object.fromEntries(easeLevels.map((level) =>
    [level, [...labels.values()].filter((ease) => ease.level === level).length]))
  log(`Jev ease: ${labels.size}/${repositories.length} labelled (${reused} reused, ${failures} failed); ` +
    easeLevels.map((level) => `${level} ${counts[level]}`).join(', ') + '.')
  return repositories.map((repository) => {
    const ease = labels.get(repository.id)
    return ease ? { ...repository, research: { ...repository.research, ease } } : repository
  })
}
