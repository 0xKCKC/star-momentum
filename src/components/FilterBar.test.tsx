import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FilterBar } from './FilterBar'

describe('FilterBar', () => {
  it('reports category and search changes', () => {
    const onCategoryChange = vi.fn()
    const onQueryChange = vi.fn()
    render(
      <FilterBar
        category="all"
        onCategoryChange={onCategoryChange}
        query=""
        onQueryChange={onQueryChange}
        resultCount={18}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'AI' }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'rust' } })

    expect(onCategoryChange).toHaveBeenCalledWith('ai')
    expect(onQueryChange).toHaveBeenCalledWith('rust')
    expect(screen.getByText('18')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '上手難度' })).toBeNull()
  })

  it('shows the ease filter when labels exist', () => {
    const onEaseChange = vi.fn()
    render(
      <FilterBar
        category="all"
        onCategoryChange={vi.fn()}
        ease="all"
        onEaseChange={onEaseChange}
        query=""
        onQueryChange={vi.fn()}
        resultCount={5}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '下載即用' }))
    expect(onEaseChange).toHaveBeenCalledWith('ready')
  })
})
