import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RankSparkline } from './RankSparkline'

describe('RankSparkline', () => {
  it('draws one line per unbroken run and marks today', () => {
    const { container } = render(<RankSparkline ranks={[9, 7, null, 4, 2, 1]} />)

    expect(container.querySelectorAll('polyline')).toHaveLength(2)
    expect(container.querySelector('circle')).not.toBeNull()
    expect(container.querySelector('title')?.textContent).toBe('近 6 日名次：由第 9 名到第 1 名，最高第 1 名')
  })

  it('draws nothing with fewer than three charted days', () => {
    const { container } = render(<RankSparkline ranks={[null, 12, 8]} />)

    expect(container.querySelector('svg')).toBeNull()
  })
})
