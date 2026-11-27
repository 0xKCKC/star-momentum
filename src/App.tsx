import { useDeferredValue, useMemo, useState } from 'react'
import type { EaseLevel, RepositoryCategory } from './domain/repository'
import { usePeriodRanking } from './hooks/usePeriodRanking'
import { useRankingData } from './hooks/useRankingData'
import { FilterBar } from './components/FilterBar'
import { Header } from './components/Header'
import { HeroSummary } from './components/HeroSummary'
import { Methodology } from './components/Methodology'
import { PeriodList } from './components/PeriodList'
import { PeriodTabs, type ChartView } from './components/PeriodTabs'
import { Podium } from './components/Podium'
import { RankingList } from './components/RankingList'
import { PageState } from './components/PageState'

export function App() {
  const { data, loading, error } = useRankingData()
  const [category, setCategory] = useState<RepositoryCategory | 'all'>('all')
  const [ease, setEase] = useState<EaseLevel | 'all'>('all')
  const [query, setQuery] = useState('')
  const [view, setView] = useState<ChartView>('today')
  const periodRanking = usePeriodRanking(view === 'today' ? null : view)

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
  const filteredPeriod = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase()

    return (periodRanking.data?.repositories ?? []).filter((repository) => {
      const matchesCategory = category === 'all' || repository.categories.includes(category)
      const matchesQuery = !normalizedQuery || [
        repository.fullName,
        repository.description,
        repository.introduction ?? '',
        repository.language ?? '',
        ...repository.topics
      ].some((value) => value.toLowerCase().includes(normalizedQuery))

      return matchesCategory && matchesQuery
    })
  }, [category, deferredQuery, periodRanking.data])
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
            <h2 id="ranking-title">{view === 'today' ? '今日排行' : view === 'week' ? '7 日排行' : '30 日排行'}</h2>
            <p>
              {view === 'today'
                ? '排名來自 star 增長和開發活動。'
                : `按 ${view === 'week' ? 7 : 30} 日新增 stars 排名：絕對增長佔六成，相對期初規模的增幅佔四成。`}
            </p>
            <PeriodTabs view={view} onViewChange={setView} />
          </div>
          <FilterBar
            category={category}
            onCategoryChange={setCategory}
            {...(hasEase && view === 'today' ? { ease, onEaseChange: setEase } : {})}
            query={query}
            onQueryChange={setQuery}
            resultCount={view === 'today' ? filteredRepositories.length : filteredPeriod.length}
          />
          <div className="container rankings-layout">
            {view === 'today' ? (
              filteredRepositories.length > 0 ? (
                <>
                  <Podium repositories={filteredRepositories.slice(0, 3)} />
                  <RankingList repositories={filteredRepositories.slice(3)} />
                </>
              ) : (
                <PageState type="empty" />
              )
            ) : periodRanking.loading ? (
              <p className="period-note">正在讀取排行…</p>
            ) : periodRanking.unavailable ? (
              <p className="period-note">這個時段的排行會在下一次更新後提供。</p>
            ) : filteredPeriod.length > 0 ? (
              <PeriodList period={view} repositories={filteredPeriod} />
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
