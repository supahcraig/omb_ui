import type { Metrics } from '@/api/types'

type NumericMetricKey = {
  [K in keyof Metrics]: Metrics[K] extends number | null ? K : never
}[keyof Metrics]

const PERCENTILES: Array<{ key: NumericMetricKey; label: string }> = [
  { key: 'publish_latency_p50', label: 'p50' },
  { key: 'publish_latency_p75', label: 'p75' },
  { key: 'publish_latency_p95', label: 'p95' },
  { key: 'publish_latency_p99', label: 'p99' },
  { key: 'publish_latency_p999', label: 'p99.9' },
  { key: 'publish_latency_p9999', label: 'p99.99' },
  { key: 'publish_latency_max', label: 'max' },
]

function barColor(pct: number, max: number): string {
  const ratio = pct / max
  if (ratio < 0.5) return 'bg-indigo-500'
  if (ratio < 0.75) return 'bg-amber-500'
  return 'bg-red-500'
}

export default function LatencyBars({ metrics }: { metrics: Metrics }) {
  const values = PERCENTILES.map(p => ({ label: p.label, val: metrics[p.key] }))
  const maxVal = Math.max(...values.map(v => v.val ?? 0), 1)

  return (
    <div className="space-y-2">
      <div className="text-xs text-slate-500 uppercase tracking-wider mb-3">Publish Latency Distribution</div>
      {values.map(({ label, val }) => (
        <div key={label} className="flex items-center gap-3 text-sm">
          <span className="w-12 text-right text-slate-500 text-xs">{label}</span>
          <div className="flex-1 bg-slate-800 rounded h-4 overflow-hidden">
            <div
              className={`h-full rounded transition-all ${barColor(val ?? 0, maxVal)}`}
              style={{ width: `${((val ?? 0) / maxVal) * 100}%` }}
            />
          </div>
          <span className="w-16 text-right font-mono text-xs text-slate-300">
            {val != null ? `${val.toFixed(2)}ms` : '—'}
          </span>
        </div>
      ))}
    </div>
  )
}
