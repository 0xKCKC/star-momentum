import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { RankedRepository, RankingDocument } from '../domain/repository'

// GitHub Trending has no memory: it cannot say when a repository first appeared or how long it
// has stayed. The stored daily history can, so each Top 50 repository gets its chart record.
// It never changes scores or ranks.

const RECENT_DAYS = 14

export interface ChartDay {
  date: string
  repositories: Array<Pick<RankedRepository, 'id' | 'rank'> & { research?: Pick<RankedRepository['research'], 'githubTrending'> }>
  githubTrending?: RankingDocument['githubTrending']
}

export async function loadChartDays(root: string, beforeDate: string): Promise<ChartDay[]> {
  const directory = join(root, 'public', 'data', 'history')
  let names: string[]
  try {
    names = await readdir(directory)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const eligible = names
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name) && name.slice(0, 10) < beforeDate)
    .sort()
  return Promise.all(eligible.map(async (name) => {
    const document = JSON.parse(await readFile(join(directory, name), 'utf8')) as RankingDocument
    return { date: name.slice(0, 10), repositories: document.repositories, githubTrending: document.githubTrending }
  }))
}

export function addChartHistory(
  repositories: RankedRepository[],
  days: ChartDay[],
  today: string
): RankedRepository[] {
  const earlier = [...days].filter(({ date }) => date < today).sort((left, right) => left.date.localeCompare(right.date))
  const ranksByDay = earlier.map(({ date, repositories: listed }) => ({
    date,
    ranks: new Map(listed.map(({ id, rank }) => [id, rank]))
  }))

  return repositories.map((repository) => {
    const appearances = ranksByDay.filter(({ ranks }) => ranks.has(repository.id))
    let streak = 1
    for (let index = ranksByDay.length - 1; index >= 0 && ranksByDay[index].ranks.has(repository.id); index -= 1) {
      streak += 1
    }
    const chart = {
      firstSeen: appearances[0]?.date ?? today,
      days: appearances.length + 1,
      streak,
      bestRank: Math.min(repository.rank, ...appearances.map(({ ranks }) => ranks.get(repository.id)!)),
      recent: [
        ...ranksByDay.slice(-(RECENT_DAYS - 1)).map(({ ranks }) => ranks.get(repository.id) ?? null),
        repository.rank
      ]
    }
    return {
      ...repository,
      research: {
        ...repository.research,
        chart,
        evidence: [...repository.research.evidence, chartEvidence(chart)]
      }
    }
  })
}

export function chartEvidence(chart: NonNullable<RankedRepository['research']['chart']>): string {
  if (chart.days === 1) return '本榜紀錄：今日首次上榜'
  return `本榜紀錄：${chart.firstSeen} 首次上榜，累計 ${chart.days} 日（連續 ${chart.streak} 日），最高第 ${chart.bestRank} 名`
}
