interface Props {
  label: string
  unit: string
  current: number | null
  avg: number | null
  min: number | null
  max: number | null
  scaleMax: number
  color?: string
}

const W = 200, H = 115
const CX = W / 2, CY = H - 4
const R = 85
const TRACK_W = 14

function clamp01(v: number) { return Math.max(0, Math.min(1, v)) }

function arcPoint(f: number): [number, number] {
  const a = Math.PI * (1 - clamp01(f))
  return [CX + R * Math.cos(a), CY - R * Math.sin(a)]
}

function arcPath(f0: number, f1: number): string {
  const [x0, y0] = arcPoint(f0)
  const [x1, y1] = arcPoint(f1)
  const large = f1 - f0 > 0.5 ? 1 : 0
  return `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${R} ${R} 0 ${large} 0 ${x1.toFixed(1)} ${y1.toFixed(1)}`
}

function needleTip(f: number, r: number): [number, number] {
  const a = Math.PI * (1 - clamp01(f))
  return [CX + r * Math.cos(a), CY - r * Math.sin(a)]
}

function fmt(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 10_000)    return `${(v / 1_000).toFixed(1)}K`
  if (v >= 1_000)     return `${(v / 1_000).toFixed(2)}K`
  return v.toFixed(1)
}

export default function Gauge({ label, unit, current, avg, min, max, scaleMax, color = '#6366f1' }: Props) {
  const frac = (v: number) => clamp01(v / (scaleMax || 1))

  const cf   = current != null ? frac(current) : null
  const af   = avg     != null ? frac(avg)     : null
  const minF = min     != null ? frac(min)     : null
  const maxF = max     != null ? frac(max)     : null

  const [nx, ny] = cf != null ? needleTip(cf, R - 6) : [CX, CY]
  const [ax, ay] = af != null ? needleTip(af, R + 2) : [CX, CY]

  return (
    <div className="flex flex-col items-center">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxWidth: 200 }}>
        {/* Track */}
        <path d={arcPath(0, 1)} fill="none" stroke="#1e293b" strokeWidth={TRACK_W} strokeLinecap="round" />

        {/* Min–max band */}
        {minF != null && maxF != null && minF < maxF && (
          <path d={arcPath(minF, maxF)} fill="none" stroke={color}
            strokeWidth={TRACK_W} strokeLinecap="round" opacity="0.35" />
        )}

        {/* Average tick */}
        {af != null && (
          <line x1={CX} y1={CY} x2={ax} y2={ay}
            stroke="#94a3b8" strokeWidth="1.5" strokeLinecap="round" opacity="0.8" />
        )}

        {/* Current needle */}
        {cf != null && (
          <line x1={CX} y1={CY} x2={nx} y2={ny}
            stroke="white" strokeWidth="2.5" strokeLinecap="round" />
        )}

        {/* Pivot */}
        <circle cx={CX} cy={CY} r="5" fill="#1e293b" stroke="#475569" strokeWidth="1.5" />

        {/* Current value */}
        <text x={CX} y={CY - 28} textAnchor="middle"
          fill="white" fontSize="20" fontWeight="bold" fontFamily="ui-monospace,monospace">
          {current != null ? fmt(current) : '—'}
        </text>
        <text x={CX} y={CY - 13} textAnchor="middle" fill="#475569" fontSize="10">
          {unit}
        </text>

        {/* Scale endpoints */}
        <text x="8"     y={CY + 2} textAnchor="start" fill="#334155" fontSize="9">0</text>
        <text x={W - 6} y={CY + 2} textAnchor="end"   fill="#334155" fontSize="9">{fmt(scaleMax)}</text>
      </svg>

      <div className="text-xs text-slate-400 font-medium -mt-1">{label}</div>
      {avg != null && (
        <div className="text-xs text-slate-600">avg {fmt(avg)}</div>
      )}
    </div>
  )
}
