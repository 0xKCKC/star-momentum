import { choice, noul, TypeSafeClient, APIError, type NoulQuestion } from '@typesafe-ai/sdk'
import { buildResearch } from '../domain/research'
import { repositoryCategories, riskCautions, type RankedRepository, type RepositoryCategory, type RiskFlag } from '../domain/repository'

// Optional judgments from TypeSafe's Jev model: categories and risk warnings for the Top 50.
// Jev returns typed choices and probabilities instead of generated text, so there is nothing
// to parse or sanitize. Without TYPESAFE_API_KEY, or on any failure, the rule-based research
// stays. Nothing here changes scores or ranks, and risky repositories stay in the ranking.

const CONCURRENCY = 5
/** A second category is shown when Jev's yes-probability for it reaches this. To be checked on real runs. */
const SECONDARY_MIN_YES = 0.6
/** A risk warning is shown when Jev's yes-probability reaches this. To be checked on real runs. */
const RISK_MIN_YES = 0.7

const categoryCriteria: Record<RepositoryCategory, string> = {
  ai: 'AI models, LLM applications, AI agents, skills or plugins for AI coding assistants, machine learning research and tooling',
  devtools: 'Tools for programmers: command-line tools, editors, testing, build tools, libraries and SDKs that fit no more specific category',
  web: 'Websites, web apps, frontend frameworks, UI component libraries, browser extensions, web servers',
  data: 'Databases, data pipelines, analytics, scraping, search, data visualization',
  infra: 'Cloud, DevOps, self-hosting, servers, networking, proxies and VPNs, containers, deployment, monitoring',
  security: 'Security, privacy, vulnerabilities and exploits, malware analysis, OSINT, authentication',
  mobile: 'Apps or tools for iOS and Android phones and tablets, or for building them',
  desktop: 'Desktop apps and system utilities for macOS, Windows or Linux; operating systems, drivers, hardware and embedded devices',
  creative: 'Creating or editing images, photos, video, audio, music, 3D, design or documents',
  games: 'Games, game mods, emulators, game engines, and graphics or performance tools for games',
  learning: 'Guides, tutorials, courses, books, awesome lists and other curated reading or learning material',
  other: 'None of the above, or the description is too vague to tell what the project does'
}

const categoryQuestion = choice(
  {
    task: 'Which category best describes what `repository` is?',
    rules: [
      'Judge by what the project does and who uses it, not by its programming language.',
      'Platforms it merely supports do not decide the category; a model that also runs on phones is still AI.',
      'Choose ai when AI is the main point of the project, such as a model, an agent, or a skill for an AI coding assistant.'
    ]
  },
  categoryCriteria
)

type SecondaryCategory = Exclude<RepositoryCategory, 'other'>
const secondaryCategories = repositoryCategories.filter((category): category is SecondaryCategory => category !== 'other')

// Choice picks one main category. Several may apply, so each category also gets its own
// yes/no question in the same request; question IDs are not sent, so each one is self-contained.
const alsoQuestions = Object.fromEntries(secondaryCategories.map((category) => [
  `also_${category}`,
  noul(
    {
      task: 'Is `repository` substantially a project of the kind described in `category`, even if that is not its main purpose?',
      category: categoryCriteria[category]
    },
    {
      true: 'A large part of what the project does or who it serves fits this category',
      false: 'It only touches this category in passing, or not at all'
    }
  )
])) as Record<`also_${SecondaryCategory}`, NoulQuestion>

// One self-contained yes/no question per risk, asked in the same request as the categories.
// Star inflation comes from the stargazer audit, not from Jev.
type JevRiskFlag = Exclude<RiskFlag, 'starInflation'>

const riskQuestions: Record<JevRiskFlag, NoulQuestion> = {
  piracy: noul(
    'Does `repository` help pirate, crack, keygen or activate paid software or media, or bypass DRM or license checks?',
    { true: 'Cracking, activation, piracy or DRM/license bypass is a main purpose', false: 'It does not, or only mentions such things in passing' }
  ),
  leaked: noul(
    'Is `repository` built on or distributing leaked, stolen or unreleased proprietary code, binaries, builds or models?',
    { true: 'It relies on or redistributes leaked or unauthorized proprietary material', false: 'Its material is original, open source or officially released' }
  ),
  adult: noul(
    'Is `repository` mainly about pornography or sexual content, including tools to download, generate or undress such content?',
    { true: 'Sexual or pornographic content is a main purpose', false: 'It is not about sexual content' }
  ),
  crypto: noul(
    'Does `repository` promote or launch a specific cryptocurrency token, meme coin, airdrop or token sale?',
    { true: 'Promoting or launching a token is a main purpose', false: 'It does not promote a token; general blockchain or finance tooling does not count' }
  ),
  serviceAbuse: noul(
    'Does `repository` give access to a paid or account-limited service without paying for it, for example through reverse-engineered APIs, shared account pools, or free-trial farming?',
    { true: 'Getting a paid or limited service for free or beyond its terms is a main purpose', false: 'It uses services within their normal terms, or not at all' }
  ),
  misuse: noul(
    'Is `repository` malware, a ready-to-use exploit or attack tool, or a tool to spy on people or access their accounts or private data without permission?',
    { true: 'It is mainly a tool for attacking systems or people, or for surveillance without consent', false: 'It is defensive, educational at a conceptual level, or unrelated to attacks' }
  )
}
const riskFlags = Object.keys(riskQuestions) as JevRiskFlag[]
const riskQuestionsById = Object.fromEntries(riskFlags.map((flag) => [`risk_${flag}`, riskQuestions[flag]])) as
  Record<`risk_${JevRiskFlag}`, NoulQuestion>

interface JevClient {
  systemOne: TypeSafeClient['systemOne']
}

interface JevOptions {
  apiKey?: string
  client?: JevClient
  log?: (message: string) => void
}

export interface JevJudgment {
  categories: RepositoryCategory[] | null
  risks: Array<{ flag: JevRiskFlag, yes: number }>
}

export function risksFromAnswers(yes: Partial<Record<JevRiskFlag, number>>): Array<{ flag: JevRiskFlag, yes: number }> {
  return riskFlags
    .map((flag) => ({ flag, yes: yes[flag] ?? 0 }))
    .filter(({ yes: probability }) => probability >= RISK_MIN_YES)
}

export function categoriesFromAnswers(
  selected: string,
  alsoYes: Partial<Record<SecondaryCategory, number>>
): RepositoryCategory[] | null {
  if (!repositoryCategories.includes(selected as RepositoryCategory)) return null
  const primary = selected as RepositoryCategory
  if (primary === 'other') return [primary]
  const secondary = Object.entries(alsoYes)
    .filter(([category, yes]) => category !== primary && (yes ?? 0) >= SECONDARY_MIN_YES)
    .sort((left, right) => (right[1] ?? 0) - (left[1] ?? 0))[0]
  return secondary ? [primary, secondary[0] as RepositoryCategory] : [primary]
}

async function judge(client: JevClient, repository: RankedRepository): Promise<JevJudgment> {
  const { answers } = await client.systemOne({
    state: {
      repository: {
        name: repository.fullName,
        description: repository.description.slice(0, 500),
        language: repository.language,
        topics: repository.topics.slice(0, 15)
      }
    },
    questions: {
      category: categoryQuestion,
      ...alsoQuestions,
      ...riskQuestionsById
    }
  })
  const alsoYes = Object.fromEntries(secondaryCategories.map((category) =>
    [category, answers[`also_${category}`]?.noul ?? 0]))
  const riskYes = Object.fromEntries(riskFlags.map((flag) => [flag, answers[`risk_${flag}`]?.noul ?? 0]))
  return {
    categories: categoriesFromAnswers(answers.category.choice, alsoYes),
    risks: risksFromAnswers(riskYes)
  }
}

function isFatal(error: unknown): boolean {
  return error instanceof APIError && [400, 401, 403, 404, 422].includes(error.status)
}

export async function researchWithJev(
  repositories: RankedRepository[],
  options: JevOptions = {}
): Promise<RankedRepository[]> {
  const log = options.log ?? (() => undefined)
  if (!options.client && !options.apiKey) {
    log('Jev research skipped: no TYPESAFE_API_KEY.')
    return repositories
  }
  const client = options.client ?? new TypeSafeClient({ apiKey: options.apiKey, timeout: 15_000, logLevel: 'off' })

  // With neither a description nor topics Jev would only be guessing from the name.
  const pending = repositories.filter((repository) => repository.description.trim() || repository.topics.length > 0)
  const judgments = new Map<number, JevJudgment>()
  let failures = 0
  let stopped = false

  const worker = async () => {
    while (!stopped) {
      const repository = pending.shift()
      if (!repository) return
      try {
        judgments.set(repository.id, await judge(client, repository))
      } catch (error) {
        failures += 1
        const message = error instanceof Error ? error.message : String(error)
        if (failures <= 3) log(`Jev failed for ${repository.fullName}: ${message}`)
        if (isFatal(error)) {
          stopped = true
          log('Jev research stopped: the API rejected the request or the key.')
        }
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  let agreed = 0
  let categorized = 0
  const result = repositories.map((repository) => {
    const judgment = judgments.get(repository.id)
    if (!judgment) return repository
    const categories = judgment.categories ?? repository.categories
    if (judgment.categories) {
      categorized += 1
      if (judgment.categories[0] === repository.categories[0]) agreed += 1
    }
    for (const { flag, yes } of judgment.risks) log(`Jev risk: ${repository.fullName} ${flag} ${yes.toFixed(2)}`)
    const research = buildResearch(repository, repository.signals, categories)
    const risks = judgment.risks.map(({ flag }) => flag)
    return {
      ...repository,
      categories,
      research: {
        ...research,
        cautions: [...risks.map((flag) => riskCautions[flag]), ...research.cautions],
        ...(judgment.categories ? { categorySource: 'jev' as const } : {}),
        ...(risks.length > 0 ? { risks } : {})
      }
    }
  })
  const flagged = result.filter(({ research }) => research.risks?.length).length
  log(`Jev judged ${judgments.size}/${repositories.length} repositories (${failures} failed); ` +
    `primary category matched the rules for ${agreed}/${categorized}; ${flagged} flagged with risks.`)
  return result
}
