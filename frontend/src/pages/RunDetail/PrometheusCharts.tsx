import { useQuery } from '@tanstack/react-query'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { api } from '@/api/client'
import type { PrometheusSample } from '@/api/types'

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const TICK     = { fill: '#64748b', fontSize: 11 }
const GRID     = '#1e293b'
const TT_STYLE = { background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', fontSize: '12px' }
const MARGIN   = { top: 5, right: 20, left: 10, bottom: 24 }
const XLABEL   = { value: 'elapsed (mm:ss)', position: 'insideBottom' as const, offset: -12, fill: '#475569', fontSize: 11 }

function batchPoints(samples: PrometheusSample[]) {
  return samples.map(s => ({
    t: s.t,
    batch_kb: s.batch_size_bytes != null ? Math.round(s.batch_size_bytes / 1024) : null,
  }))
}

function bytesPoints(samples: PrometheusSample[]) {
  return samples.map(s => ({
    t: s.t,
    bytes_in:  s.bytes_in_per_sec  != null ? parseFloat((s.bytes_in_per_sec  / (1024 * 1024)).toFixed(2)) : null,
    bytes_out: s.bytes_out_per_sec != null ? parseFloat((s.bytes_out_per_sec / (1024 * 1024)).toFixed(2)) : null,
  }))
}

export default function PrometheusCharts({ runId }: { runId: number }) {
  const { data: samples = [] } = useQuery({
    queryKey: ['prometheus', runId],
    queryFn: () => api.getRunPrometheus(runId),
  })

  if (samples.length === 0) {
    return (
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-5">
        <div className="text-sm text-slate-500">Prometheus data unavailable for this run.</div>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-5">
        <div className="text-sm font-medium text-slate-300 mb-4">Effective batch size</div>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={batchPoints(samples)} margin={MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis dataKey="t" tickFormatter={fmtTime} tickCount={9} tick={TICK} label={XLABEL} />
            <YAxis tick={TICK} width={48}
              label={{ value: 'KB', angle: -90, position: 'insideLeft', offset: 10, fill: '#475569', fontSize: 11 }} />
            <Tooltip contentStyle={TT_STYLE} labelFormatter={s => `t = ${fmtTime(s as number)}`} />
            <Line type="monotone" dataKey="batch_kb" name="batch size (KB)"
              stroke="#f59e0b" dot={false} strokeWidth={2} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-slate-900 border border-slate-700 rounded-lg p-5">
        <div className="text-sm font-medium text-slate-300 mb-4">Broker bytes in / out</div>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={bytesPoints(samples)} margin={MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis dataKey="t" tickFormatter={fmtTime} tickCount={9} tick={TICK} label={XLABEL} />
            <YAxis tick={TICK} width={55}
              label={{ value: 'MB/s', angle: -90, position: 'insideLeft', offset: 10, fill: '#475569', fontSize: 11 }} />
            <Tooltip contentStyle={TT_STYLE} labelFormatter={s => `t = ${fmtTime(s as number)}`} />
            <Legend wrapperStyle={{ fontSize: '11px', color: '#94a3b8', paddingTop: '8px' }} />
            <Line type="monotone" dataKey="bytes_in"  name="bytes in"  stroke="#8b5cf6" dot={false} strokeWidth={2} connectNulls />
            <Line type="monotone" dataKey="bytes_out" name="bytes out" stroke="#06b6d4" dot={false} strokeWidth={2} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
