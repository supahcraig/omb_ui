import Gauge from './Gauge'

export interface MetricAccum {
  current: number | null
  min: number | null
  max: number | null
  sum: number
  count: number
}

export interface LiveMetricState {
  pubRate:  MetricAccum
  consRate: MetricAccum
  backlog:  MetricAccum
  pubP99:   MetricAccum
}

export const EMPTY_ACCUM: MetricAccum = { current: null, min: null, max: null, sum: 0, count: 0 }

export function updateAccum(prev: MetricAccum, v: number): MetricAccum {
  return {
    current: v,
    min: prev.min === null ? v : Math.min(prev.min, v),
    max: prev.max === null ? v : Math.max(prev.max, v),
    sum: prev.sum + v,
    count: prev.count + 1,
  }
}

export function parseOmbLine(line: string): Partial<Record<keyof LiveMetricState, number>> | null {
  if (!line.includes('Pub rate')) return null
  const r: Partial<Record<keyof LiveMetricState, number>> = {}

  let m = line.match(/Pub rate\s+([\d.]+)\s+msg\/s/)
  if (m) r.pubRate = parseFloat(m[1])

  m = line.match(/Cons rate\s+([\d.]+)\s+msg\/s/)
  if (m) r.consRate = parseFloat(m[1])

  m = line.match(/Backlog:\s*([\d.]+)\s*K/)
  if (m) r.backlog = parseFloat(m[1])

  m = line.match(/Pub Latency.*?99%:\s*([\d.]+)/)
  if (m) r.pubP99 = parseFloat(m[1])

  return Object.keys(r).length > 0 ? r : null
}

function avg(m: MetricAccum): number | null {
  return m.count > 0 ? m.sum / m.count : null
}

function scaleMax(m: MetricAccum, fallback: number): number {
  return m.max != null ? m.max * 1.3 : fallback
}

interface Props {
  metrics: LiveMetricState
}

export default function LiveMetrics({ metrics }: Props) {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="text-sm font-medium text-slate-300 mb-3">Live benchmark metrics</div>
      <div className="grid grid-cols-4 gap-2">
        <Gauge label="Pub Rate"        unit="msg/s" color="#6366f1"
          current={metrics.pubRate.current}  avg={avg(metrics.pubRate)}
          min={metrics.pubRate.min}          max={metrics.pubRate.max}
          scaleMax={scaleMax(metrics.pubRate, 15000)} />

        <Gauge label="Cons Rate"       unit="msg/s" color="#06b6d4"
          current={metrics.consRate.current} avg={avg(metrics.consRate)}
          min={metrics.consRate.min}         max={metrics.consRate.max}
          scaleMax={scaleMax(metrics.consRate, 15000)} />

        <Gauge label="Backlog"         unit="K msgs" color="#f59e0b"
          current={metrics.backlog.current}  avg={avg(metrics.backlog)}
          min={metrics.backlog.min}          max={metrics.backlog.max}
          scaleMax={scaleMax(metrics.backlog, 1000)} />

        <Gauge label="Pub P99 Latency" unit="ms"    color="#f43f5e"
          current={metrics.pubP99.current}   avg={avg(metrics.pubP99)}
          min={metrics.pubP99.min}           max={metrics.pubP99.max}
          scaleMax={scaleMax(metrics.pubP99, 50)} />
      </div>
    </div>
  )
}
