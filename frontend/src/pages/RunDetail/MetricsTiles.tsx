import type { Metrics } from '@/api/types'

interface TileProps { label: string; value: string; color?: string }

function Tile({ label, value, color = 'text-emerald-400' }: TileProps) {
  return (
    <div className="bg-slate-900 rounded-lg p-4 text-center">
      <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
    </div>
  )
}

function fmt(v: number | null | undefined, decimals = 1) {
  return v != null ? v.toFixed(decimals) : '—'
}

export default function MetricsTiles({ metrics }: { metrics: Metrics }) {
  const rate = metrics.publish_rate_avg != null
    ? `${Math.round(metrics.publish_rate_avg).toLocaleString()}/s` : '—'
  return (
    <div className="grid grid-cols-4 gap-4">
      <Tile label="Publish Rate" value={rate} />
      <Tile label="p99 Latency" value={`${fmt(metrics.publish_latency_p99)}ms`}
        color={metrics.publish_latency_p99 != null && metrics.publish_latency_p99 < 5 ? 'text-emerald-400' : 'text-amber-400'} />
      <Tile label="p99.9 Latency" value={`${fmt(metrics.publish_latency_p999)}ms`} color="text-amber-400" />
      <Tile label="Avg E2E" value={`${fmt(metrics.end_to_end_latency_avg)}ms`} />
    </div>
  )
}
