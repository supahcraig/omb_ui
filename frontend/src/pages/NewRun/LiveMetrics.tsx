import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

export interface LivePoint {
  t: number
  pubRate:  number | null
  consRate: number | null
  backlog:  number | null
  pubP50:   number | null
  pubP95:   number | null
  pubP99:   number | null
  pubP999:  number | null
  e2eP50:   number | null
  e2eP95:   number | null
  e2eP99:   number | null
  e2eP999:  number | null
}

export type LiveMetricState = LivePoint[]

export function parseOmbLine(line: string): Omit<LivePoint, 't'> | null {
  if (!line.includes('Pub rate')) return null

  const r: Omit<LivePoint, 't'> = {
    pubRate: null, consRate: null, backlog: null,
    pubP50: null, pubP95: null, pubP99: null, pubP999: null,
    e2eP50: null, e2eP95: null, e2eP99: null, e2eP999: null,
  }

  let m = line.match(/Pub rate\s+([\d.]+)\s+msg\/s/)
  if (m) r.pubRate = parseFloat(m[1])

  m = line.match(/Cons rate\s+([\d.]+)\s+msg\/s/)
  if (m) r.consRate = parseFloat(m[1])

  m = line.match(/Backlog:\s*([\d.]+)\s*K/)
  if (m) r.backlog = Math.max(0, parseFloat(m[1]))

  const pubSec = line.match(/Pub Latency[^|]*/)?.[0] ?? ''
  if (pubSec) {
    m = pubSec.match(/\b50%:\s*([\d.]+)/);   if (m) r.pubP50  = parseFloat(m[1])
    m = pubSec.match(/\b95%:\s*([\d.]+)/);   if (m) r.pubP95  = parseFloat(m[1])
    m = pubSec.match(/\b99%:\s*([\d.]+)/);   if (m) r.pubP99  = parseFloat(m[1])
    m = pubSec.match(/99\.9%:\s*([\d.]+)/);  if (m) r.pubP999 = parseFloat(m[1])
  }

  const e2eSec = line.match(/E2E Latency[^|]*/)?.[0] ?? ''
  if (e2eSec) {
    m = e2eSec.match(/\b50%:\s*([\d.]+)/);   if (m) r.e2eP50  = parseFloat(m[1])
    m = e2eSec.match(/\b95%:\s*([\d.]+)/);   if (m) r.e2eP95  = parseFloat(m[1])
    m = e2eSec.match(/\b99%:\s*([\d.]+)/);   if (m) r.e2eP99  = parseFloat(m[1])
    m = e2eSec.match(/99\.9%:\s*([\d.]+)/);  if (m) r.e2eP999 = parseFloat(m[1])
  }

  return r
}

const fmtTime  = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const TICK     = { fill: '#64748b', fontSize: 11 }
const GRID     = '#1e293b'
const TT_STYLE = { background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', fontSize: '12px' }
const MARGIN   = { top: 5, right: 16, left: 8, bottom: 22 }
const XLABEL   = { value: 'elapsed (mm:ss)', position: 'insideBottom' as const, offset: -10, fill: '#475569', fontSize: 10 }

function Chart({ title, children, height = 160 }: { title: string; children: React.ReactNode; height?: number }) {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="text-xs font-medium text-slate-400 mb-2">{title}</div>
      <ResponsiveContainer width="100%" height={height}>{children as React.ReactElement}</ResponsiveContainer>
    </div>
  )
}

interface Props { points: LivePoint[] }

export default function LiveMetrics({ points }: Props) {
  const hasE2E = points.some(p => p.e2eP99 != null)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Chart title="Throughput">
          <LineChart data={points} margin={MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis dataKey="t" tickFormatter={fmtTime} tickCount={6} tick={TICK} label={XLABEL} />
            <YAxis tick={TICK} width={60} tickFormatter={v => (v as number).toLocaleString()}
              label={{ value: 'msg/s', angle: -90, position: 'insideLeft', offset: 10, fill: '#475569', fontSize: 10 }} />
            <Tooltip contentStyle={TT_STYLE} labelFormatter={s => `t = ${fmtTime(s as number)}`}
              formatter={v => [(v as number).toLocaleString(), '']} />
            <Legend wrapperStyle={{ fontSize: '10px', color: '#94a3b8', paddingTop: '4px' }} />
            <Line type="monotone" dataKey="pubRate"  name="pub rate"  stroke="#6366f1" dot={false} strokeWidth={2} connectNulls />
            <Line type="monotone" dataKey="consRate" name="cons rate" stroke="#10b981" dot={false} strokeWidth={2} connectNulls />
          </LineChart>
        </Chart>

        <Chart title="Consumer backlog">
          <AreaChart data={points} margin={MARGIN}>
            <defs>
              <linearGradient id="liveBacklogGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis dataKey="t" tickFormatter={fmtTime} tickCount={6} tick={TICK} label={XLABEL} />
            <YAxis tick={TICK} width={55} tickFormatter={v => (v as number).toLocaleString()}
              label={{ value: 'K msgs', angle: -90, position: 'insideLeft', offset: 10, fill: '#475569', fontSize: 10 }} />
            <Tooltip contentStyle={TT_STYLE} labelFormatter={s => `t = ${fmtTime(s as number)}`}
              formatter={v => [`${v}K`, 'backlog']} />
            <Area type="monotone" dataKey="backlog" stroke="#f59e0b" strokeWidth={2}
              fill="url(#liveBacklogGrad)" dot={false} connectNulls />
          </AreaChart>
        </Chart>
      </div>

      <div className={`grid gap-3 ${hasE2E ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <Chart title="Publish latency percentiles">
          <LineChart data={points} margin={MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis dataKey="t" tickFormatter={fmtTime} tickCount={6} tick={TICK} label={XLABEL} />
            <YAxis tick={TICK} width={48}
              label={{ value: 'ms', angle: -90, position: 'insideLeft', offset: 10, fill: '#475569', fontSize: 10 }} />
            <Tooltip contentStyle={TT_STYLE} labelFormatter={s => `t = ${fmtTime(s as number)}`}
              formatter={(v, n) => [`${v} ms`, n]} />
            <Legend wrapperStyle={{ fontSize: '10px', color: '#94a3b8', paddingTop: '4px' }} />
            <Line type="monotone" dataKey="pubP50"  name="p50"   stroke="#10b981" dot={false} strokeWidth={1.5} connectNulls />
            <Line type="monotone" dataKey="pubP95"  name="p95"   stroke="#f59e0b" dot={false} strokeWidth={1.5} connectNulls />
            <Line type="monotone" dataKey="pubP99"  name="p99"   stroke="#f97316" dot={false} strokeWidth={2}   connectNulls />
            <Line type="monotone" dataKey="pubP999" name="p99.9" stroke="#ef4444" dot={false} strokeWidth={2}   connectNulls />
          </LineChart>
        </Chart>

        {hasE2E && (
          <Chart title="E2E latency percentiles">
            <LineChart data={points} margin={MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="t" tickFormatter={fmtTime} tickCount={6} tick={TICK} label={XLABEL} />
              <YAxis tick={TICK} width={48}
                label={{ value: 'ms', angle: -90, position: 'insideLeft', offset: 10, fill: '#475569', fontSize: 10 }} />
              <Tooltip contentStyle={TT_STYLE} labelFormatter={s => `t = ${fmtTime(s as number)}`}
                formatter={(v, n) => [`${v} ms`, n]} />
              <Legend wrapperStyle={{ fontSize: '10px', color: '#94a3b8', paddingTop: '4px' }} />
              <Line type="monotone" dataKey="e2eP50"  name="p50"   stroke="#10b981" dot={false} strokeWidth={1.5} connectNulls />
              <Line type="monotone" dataKey="e2eP95"  name="p95"   stroke="#f59e0b" dot={false} strokeWidth={1.5} connectNulls />
              <Line type="monotone" dataKey="e2eP99"  name="p99"   stroke="#f97316" dot={false} strokeWidth={2}   connectNulls />
              <Line type="monotone" dataKey="e2eP999" name="p99.9" stroke="#ef4444" dot={false} strokeWidth={2}   connectNulls />
            </LineChart>
          </Chart>
        )}
      </div>
    </div>
  )
}
