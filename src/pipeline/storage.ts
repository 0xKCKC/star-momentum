import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { PeriodRanking, RankingDocument, RepositorySnapshot } from '../domain/repository'

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try {
    await rename(temporaryPath, path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EPERM' && code !== 'EEXIST') throw error
    await copyFile(temporaryPath, path)
    await rm(temporaryPath, { force: true })
  }
}

export async function loadCurrentRanking(root: string): Promise<RankingDocument | null> {
  return readJson<RankingDocument>(join(root, 'public', 'data', 'current.json'))
}

export async function loadSnapshotHistory(root: string, beforeDate: string, count = 8): Promise<RepositorySnapshot[]> {
  const directory = join(root, 'data', 'snapshots')
  try {
    const names = await readdir(directory)
    const eligibleNames = names
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
      .filter((name) => name.slice(0, 10) < beforeDate)
      .sort()
      .slice(-count)
    const snapshots = await Promise.all(
      eligibleNames.map((name) => readJson<RepositorySnapshot>(join(directory, name)))
    )
    return snapshots.filter((snapshot): snapshot is RepositorySnapshot => snapshot !== null)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export async function saveDailyOutputs(
  root: string,
  document: RankingDocument,
  snapshot: RepositorySnapshot,
  report: string
): Promise<void> {
  const date = document.dataDate
  await Promise.all([
    writeJsonAtomic(join(root, 'public', 'data', 'current.json'), document),
    writeJsonAtomic(join(root, 'public', 'data', 'history', `${date}.json`), document),
    writeJsonAtomic(join(root, 'data', 'snapshots', `${date}.json`), snapshot),
    mkdir(join(root, 'reports'), { recursive: true }).then(() =>
      writeFile(join(root, 'reports', `${date}.md`), report, 'utf8')
    )
  ])
}

export async function savePeriodRanking(root: string, ranking: PeriodRanking): Promise<void> {
  await writeJsonAtomic(join(root, 'public', 'data', `${ranking.period}.json`), ranking)
}
