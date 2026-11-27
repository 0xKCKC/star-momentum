interface RankSparklineProps {
  /** Ranks oldest first, today last; null when off the chart. */
  ranks: Array<number | null>
}

const WIDTH = 72
const HEIGHT = 20
const PAD = 3
const LOWEST_RANK = 50

/** Rank over the last recorded days: higher on the chart is a better rank, gaps are days off it. */
export function RankSparkline({ ranks }: RankSparklineProps) {
  const charted = ranks.filter((rank): rank is number => rank !== null)
  if (charted.length < 3) return null

  const x = (index: number) => PAD + index * (WIDTH - 2 * PAD) / Math.max(ranks.length - 1, 1)
  const y = (rank: number) => PAD + (Math.min(rank, LOWEST_RANK) - 1) * (HEIGHT - 2 * PAD) / (LOWEST_RANK - 1)
  const segments: string[] = []
  let current: string[] = []
  ranks.forEach((rank, index) => {
    if (rank === null) {
      if (current.length > 1) segments.push(current.join(' '))
      current = []
    } else {
      current.push(`${x(index).toFixed(1)},${y(rank).toFixed(1)}`)
    }
  })
  if (current.length > 1) segments.push(current.join(' '))
  const today = ranks[ranks.length - 1]
  const first = charted[0]
  const label = `近 ${ranks.length} 日名次：由第 ${first} 名到第 ${charted[charted.length - 1]} 名，最高第 ${Math.min(...charted)} 名`

  return (
    <svg className="rank-sparkline" width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={label}>
      <title>{label}</title>
      {segments.map((points) => <polyline key={points} points={points} />)}
      {today !== null && <circle cx={x(ranks.length - 1)} cy={y(today)} r="2.2" />}
    </svg>
  )
}
