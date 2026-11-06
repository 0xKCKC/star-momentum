import { useDeferredValue, useMemo, useState } from 'react'
import type { EaseLevel, RepositoryCategory } from './domain/repository'
import { useRankingData } from './hooks/useRankingData'
import { FilterBar } from './components/FilterBar'
import { Header } from './components/Header'
import { HeroSummary } from './components/HeroSummary'
import { Methodology } from './components/Methodology'
import { Podium } from './components/Podium'
import { RankingList } from './components/RankingList'
import { PageState } from './components/PageState'

export function App() {
  const { data, loading, error } = useRankingData()
  const [category, setCategory] = useState<RepositoryCategory | 'all'>('all')
  const [ease, setEase] = useState<EaseLevel | 'all'>('all')
  const [query, setQuery] = useState('')

  const deferredQuery = useDeferredValue(query)

  const searchIndex = useMemo(() => (data?.repositories ?? []).map((repository) => ({
    repository,
    searchFields: [
      repository.fullName,
      repository.description,
      repository.research.introduction?.text ?? '',
      repository.language ?? '',
      ...repository.topics
    ].map((value) => value.toLowerCase())
  })), [data])

  const filteredRepositories = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase()

    return searchIndex
      .filter(({ repository, searchFields }) => {
        const matchesCategory = category === 'all' || repository.categories.includes(category)
        const matchesEase = ease === 'all' || repository.research.ease?.level === ease
        const matchesQuery = !normalizedQuery || searchFields.some((value) => value.includes(normalizedQuery))

        return matchesCategory && matchesEase && matchesQuery
      })
      .map(({ repository }) => repository)
  }, [category, ease, deferredQuery, searchIndex])
  const hasEase = useMemo(() => (data?.repositories ?? []).some(({ research }) => research.ease), [data])

  if (loading) return <PageState type="loading" />
  if (error || !data) return <PageState type="error" message={error ?? undefined} />

  return (
    <div className="app-shell">
      <Header generatedAt={data.generatedAt} />
      <main>
        <HeroSummary document={data} />
        <section className="ranking-section" id="ranking" aria-labelledby="ranking-title">
          <div className="section-heading container">
            <h2 id="ranking-title">今日排行</h2>
            <p>排名來自 star 增長和開發活動。</p>
          </div>
          <FilterBar
            category={category}
            onCategoryChange={setCategory}
            {...(hasEase ? { ease, onEaseChange: setEase } : {})}
            query={query}
            onQueryChange={setQuery}
            resultCount={filteredRepositories.length}
          />
          <div className="container rankings-layout">
            {filteredRepositories.length > 0 ? (
              <>
                <Podium repositories={filteredRepositories.slice(0, 3)} />
                <RankingList repositories={filteredRepositories.slice(3)} />
              </>
            ) : (
              <PageState type="empty" />
            )}
          </div>
        </section>
        <Methodology status={data.status} historyDays={data.stats.historyDays} />
      </main>
      <footer className="site-footer container">
        <p>星勢只使用 GitHub 公開資料，與 GitHub 並無關聯。熱門度不是安全或品質保證。</p>
        <a href="https://github.com" target="_blank" rel="noreferrer">資料來源 GitHub</a>
      </footer>
    </div>
  )
}
