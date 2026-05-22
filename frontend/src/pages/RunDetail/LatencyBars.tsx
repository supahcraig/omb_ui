import type { Metrics } from '@/api/types'

type NumericMetricKey = {
  [K in keyof Metrics]: Metrics[K] extends number | null ? K : never
}[keyof Metrics]

const PERCENTILES: Array<{ label: string; publish: NumericMetricKey; e2e: NumericMetricKey }> = [
  { label: 'p50',    publish: 'publish_latency_p50',    e2e: 'end_to_end_latency_p50' },
  { label: 'p75',    publish: 'publish_latency_p75',    e2e: 'end_to_end_latency_p75' },
  { label: 'p95',    publish: 'publish_latency_p95',    e2e: 'end_to_end_latency_p95' },
  { label: 'p99',    publish: 'publish_latency_p99',    e2e: 'end_to_end_latency_p99' },
  { label: 'p99.9',  publish: 'publish_latency_p999',   e2e: 'end_to_end_latency_p999' },
  { label: 'p99.99', publish: 'publish_latency_p9999',  e2e: 'end_to_end_latency_p9999' },
  { label: 'max',    publish: 'publish_latency_max',    e2e: 'end_to_end_latency_max' },
]

function BarSection({
  title,
  keys,
  metrics,
  maxVal,
  color,
}: {
  title: string
  keys: Array<{ label: string; key: NumericMetricKey }>
  metrics: Metrics
  maxVal: number
  color: string
}) {
  return (
    <div className="space-y-2">
      <div className="text-xs text-slate-500 uppercase tracking-wider mb-3">{title}</div>
      {keys.map(({ label, key }) => {
        const val = metrics[key] as number | null
        return (
          <div key={label} className="flex items-center gap-3 text-sm">
            <span className="w-12 text-right text-slate-500 text-xs">{label}</span>
            <div className="flex-1 bg-slate-800 rounded h-4 overflow-hidden">
              <div
                className={`h-full rounded transition-all ${color}`}
                style={{ width: `${((val ?? 0) / maxVal) * 100}%` }}
              />
            </div>
            <span className="w-16 text-right font-mono text-xs text-slate-300">
              {val != null ? `${val.toFixed(2)}ms` : '—'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export default function LatencyBars({ metrics }: { metrics: Metrics }) {
  const allValues = PERCENTILES.flatMap(p => [
    metrics[p.publish] as number | null,
    metrics[p.e2e] as number | null,
  ])
  const maxVal = Math.max(...allValues.map(v => v ?? 0), 1)

  const publishKeys = PERCENTILES.map(p => ({ label: p.label, key: p.publish }))
  const e2eKeys     = PERCENTILES.map(p => ({ label: p.label, key: p.e2e }))

  return (
    <div className="grid grid-cols-2 gap-8">
      <BarSection title="Publish Latency" keys={publishKeys} metrics={metrics} maxVal={maxVal} color="bg-indigo-500" />
      <BarSection title="End-to-End Latency" keys={e2eKeys}  metrics={metrics} maxVal={maxVal} color="bg-emerald-500" />
    </div>
  )
}
