import { useQuery } from '@tanstack/react-query'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { api } from '@/api/client'
import type { PrometheusSample } from '@/api/types'

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const TICK     = { fill: '#94a3b8', fontSize: 12 }
const GRID     = '#1e293b'
const TT_STYLE = { background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', fontSize: '12px' }
const MARGIN   = { top: 5, right: 20, left: 10, bottom: 24 }
const XLABEL   = { value: 'elapsed (mm:ss)', position: 'insideBottom' as const, offset: -12, fill: '#94a3b8', fontSize: 12 }

function bytesPoints(samples: PrometheusSample[]) {
  return samples.map(s => ({
    t: s.t,
    bytes_in:  s.bytes_in_per_sec  != null ? parseFloat((s.bytes_in_per_sec  / (1024 * 1024)).toFixed(2)) : null,
    bytes_out: s.bytes_out_per_sec != null ? parseFloat((s.bytes_out_per_sec / (1024 * 1024)).toFixed(2)) : null,
  }))
}

function recordsPoints(samples: PrometheusSample[]) {
  return samples.map(s => ({
    t: s.t,
    rps: s.records_per_sec != null ? Math.round(s.records_per_sec) : null,
  }))
}

export default function PrometheusCharts({ runId, isRunning }: { runId: number; isRunning: boolean }) {
  const { data: samples = [] } = useQuery({
    queryKey: ['prometheus', runId],
    queryFn: () => api.getRunPrometheus(runId),
    refetchInterval: isRunning ? 10000 : false,
  })

  const allNull = samples.length > 0 && samples.every(
    s => s.bytes_in_per_sec == null && s.bytes_out_per_sec == null && s.records_per_sec == null
  )
  const hasBytes   = samples.some(s => s.bytes_in_per_sec != null || s.bytes_out_per_sec != null)
  const hasRecords = samples.some(s => s.records_per_sec != null)

  if (samples.length === 0 || allNull) {
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-5 space-y-1">
        <div className="text-sm text-slate-400 font-medium">
          {isRunning ? 'Waiting for Prometheus data…' : 'No Prometheus data was collected for this run.'}
        </div>
        <div className="text-xs text-slate-500">
          {allNull
            ? 'Samples were collected but all queries returned empty — the metric names may not match what your Prometheus has. Check the service logs: journalctl -u omb-ui -f'
            : isRunning
              ? 'Queries run every 10s. If data does not appear, use the Test button on the New Run page to diagnose the Prometheus connection.'
              : 'Prometheus may have been unreachable or misconfigured during this run. Use the Test button on the New Run page to check connectivity.'
          }
        </div>
      </div>
    )
  }

  return (
    <div className={`grid gap-4 ${hasBytes && hasRecords ? 'grid-cols-2' : 'grid-cols-1'}`}>
      {hasBytes && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm font-medium text-slate-300">Broker bytes in / out</span>
            <span className="text-[10px] font-medium px-1.5 py-px rounded uppercase tracking-wide bg-red-900/40 text-red-400 border border-red-800/60">Redpanda</span>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={bytesPoints(samples)} margin={MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="t" tickFormatter={fmtTime} tickCount={9} tick={TICK} label={XLABEL} />
              <YAxis tick={TICK} width={55}
                label={{ value: 'MB/s', angle: -90, position: 'insideLeft', offset: 10, fill: '#94a3b8', fontSize: 12 }} />
              <Tooltip contentStyle={TT_STYLE} labelFormatter={s => `t = ${fmtTime(s as number)}`} />
              <Legend wrapperStyle={{ fontSize: '12px', color: '#94a3b8', paddingTop: '8px' }} />
              <Line type="monotone" dataKey="bytes_in"  name="bytes in"  stroke="#8b5cf6" dot={false} strokeWidth={2} connectNulls />
              <Line type="monotone" dataKey="bytes_out" name="bytes out" stroke="#06b6d4" dot={false} strokeWidth={2} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {hasRecords && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm font-medium text-slate-300">Records produced / sec</span>
            <span className="text-[10px] font-medium px-1.5 py-px rounded uppercase tracking-wide bg-red-900/40 text-red-400 border border-red-800/60">Redpanda</span>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={recordsPoints(samples)} margin={MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="t" tickFormatter={fmtTime} tickCount={9} tick={TICK} label={XLABEL} />
              <YAxis tick={TICK} width={65}
                tickFormatter={v => (v as number).toLocaleString()}
                label={{ value: 'msg/s', angle: -90, position: 'insideLeft', offset: 10, fill: '#94a3b8', fontSize: 12 }} />
              <Tooltip contentStyle={TT_STYLE} labelFormatter={s => `t = ${fmtTime(s as number)}`}
                formatter={v => [(v as number).toLocaleString(), 'records/sec']} />
              <Line type="monotone" dataKey="rps" name="records/sec"
                stroke="#3b82f6" dot={false} strokeWidth={2} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
