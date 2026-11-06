import { MagnifyingGlass } from '@phosphor-icons/react'
import { categoryLabels, easeLabels, easeLevels, repositoryCategories, type EaseLevel, type RepositoryCategory } from '../domain/repository'

interface FilterBarProps {
  category: RepositoryCategory | 'all'
  onCategoryChange: (category: RepositoryCategory | 'all') => void
  ease?: EaseLevel | 'all'
  onEaseChange?: (ease: EaseLevel | 'all') => void
  query: string
  onQueryChange: (query: string) => void
  resultCount: number
}

const categories: Array<RepositoryCategory | 'all'> = ['all', ...repositoryCategories]
const eases: Array<EaseLevel | 'all'> = ['all', ...easeLevels]

export function FilterBar({
  category,
  onCategoryChange,
  ease = 'all',
  onEaseChange,
  query,
  onQueryChange,
  resultCount
}: FilterBarProps) {
  return (
    <div className="filter-shell">
      <div className="container filter-row">
        <div className="category-tabs" role="group" aria-label="項目分類">
          {categories.map((item) => (
            <button
              className={item === category ? 'category-tab is-active' : 'category-tab'}
              key={item}
              onClick={() => onCategoryChange(item)}
              type="button"
            >
              {item === 'all' ? '全部' : categoryLabels[item]}
            </button>
          ))}
        </div>
        <label className="search-field">
          <MagnifyingGlass size={18} aria-hidden="true" />
          <span className="sr-only">搜尋 repository</span>
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜尋 repo、語言或 topic"
          />
          <span className="result-count">{resultCount}</span>
        </label>
      </div>
      {onEaseChange && (
        <div className="container ease-row" role="group" aria-label="上手難度">
          <span className="ease-row-label">上手難度</span>
          {eases.map((item) => (
            <button
              className={item === ease ? 'ease-tab is-active' : 'ease-tab'}
              key={item}
              onClick={() => onEaseChange(item)}
              type="button"
              aria-pressed={item === ease}
            >
              {item === 'all' ? '不限' : easeLabels[item]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
