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

  // Store full message count, not K-multiple
  m = line.match(/Backlog:\s*([\d.]+)\s*K/)
  if (m) r.backlog = Math.max(0, Math.round(parseFloat(m[1]) * 1000))

  const pubSec = line.match(/Pub Latency[^|]*/)?.[0] ?? ''
  if (pubSec) {
    m = pubSec.match(/\b50%:\s*([\d.]+)/);  if (m) r.pubP50  = parseFloat(m[1])
    m = pubSec.match(/\b95%:\s*([\d.]+)/);  if (m) r.pubP95  = parseFloat(m[1])
    m = pubSec.match(/\b99%:\s*([\d.]+)/);  if (m) r.pubP99  = parseFloat(m[1])
    m = pubSec.match(/99\.9%:\s*([\d.]+)/); if (m) r.pubP999 = parseFloat(m[1])
  }

  const e2eSec = line.match(/E2E Latency[^|]*/)?.[0] ?? ''
  if (e2eSec) {
    m = e2eSec.match(/\b50%:\s*([\d.]+)/);  if (m) r.e2eP50  = parseFloat(m[1])
    m = e2eSec.match(/\b95%:\s*([\d.]+)/);  if (m) r.e2eP95  = parseFloat(m[1])
    m = e2eSec.match(/\b99%:\s*([\d.]+)/);  if (m) r.e2eP99  = parseFloat(m[1])
    m = e2eSec.match(/99\.9%:\s*([\d.]+)/); if (m) r.e2eP999 = parseFloat(m[1])
  }

  return r
}

// ── chart constants ──────────────────────────────────────────────────────────

const fmtTime  = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const TICK     = { fill: '#64748b', fontSize: 11 }
const GRID     = '#1e293b'
const TT_STYLE = { background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', fontSize: '12px' }
const MARGIN   = { top: 5, right: 16, left: 8, bottom: 22 }
const XLABEL   = { value: 'elapsed (mm:ss)', position: 'insideBottom' as const, offset: -10, fill: '#475569', fontSize: 10 }

const LAT_KEYS: Array<{ label: string; pub: keyof LivePoint; e2e: keyof LivePoint; color: string }> = [
  { label: 'p50',   pub: 'pubP50',  e2e: 'e2eP50',  color: '#10b981' },
  { label: 'p95',   pub: 'pubP95',  e2e: 'e2eP95',  color: '#f59e0b' },
  { label: 'p99',   pub: 'pubP99',  e2e: 'e2eP99',  color: '#f97316' },
  { label: 'p99.9', pub: 'pubP999', e2e: 'e2eP999', color: '#ef4444' },
]

// ── helpers ──────────────────────────────────────────────────────────────────

function pctStats(points: LivePoint[], key: keyof LivePoint) {
  const vals = points.map(p => p[key] as number | null).filter((v): v is number => v != null)
  if (!vals.length) return null
  const min  = Math.min(...vals)
  const max  = Math.max(...vals)
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length
  return { min, mean, max }
}

function StatsRow({ points, which }: { points: LivePoint[]; which: 'pub' | 'e2e' }) {
  return (
    <div className="mt-3 grid grid-cols-4 gap-2 border-t border-slate-800 pt-2">
      {LAT_KEYS.map(({ label, pub, e2e, color }) => {
        const s = pctStats(points, which === 'pub' ? pub : e2e)
        return (
          <div key={label} className="text-xs">
            <span className="font-semibold" style={{ color }}>{label}</span>
            {s ? (
              <div className="text-slate-500 mt-0.5 leading-snug">
                <div>min&nbsp;&nbsp;{s.min.toFixed(1)} ms</div>
                <div>avg&nbsp;&nbsp;{s.mean.toFixed(1)} ms</div>
                <div>max&nbsp;&nbsp;{s.max.toFixed(1)} ms</div>
              </div>
            ) : (
              <div className="text-slate-700 mt-0.5">—</div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Panel({ title, children, footer }: {
  title: string; children: React.ReactNode; footer?: React.ReactNode
}) {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="text-xs font-medium text-slate-400 mb-2">{title}</div>
      <ResponsiveContainer width="100%" height={160}>{children as React.ReactElement}</ResponsiveContainer>
      {footer}
    </div>
  )
}

// ── component ────────────────────────────────────────────────────────────────

interface Props { points: LivePoint[] }

export default function LiveMetrics({ points }: Props) {
  const hasE2E = points.some(p => p.e2eP99 != null)

  return (
    <div className="space-y-3">
      {/* row 1: throughput + backlog */}
      <div className="grid grid-cols-2 gap-3">
        <Panel title="Throughput">
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
        </Panel>

        <Panel title="Consumer backlog">
          <AreaChart data={points} margin={MARGIN}>
            <defs>
              <linearGradient id="liveBacklogGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis dataKey="t" tickFormatter={fmtTime} tickCount={6} tick={TICK} label={XLABEL} />
            <YAxis tick={TICK} width={65} tickFormatter={v => (v as number).toLocaleString()}
              label={{ value: 'messages', angle: -90, position: 'insideLeft', offset: 10, fill: '#475569', fontSize: 10 }} />
            <Tooltip contentStyle={TT_STYLE} labelFormatter={s => `t = ${fmtTime(s as number)}`}
              formatter={v => [(v as number).toLocaleString(), 'backlog']} />
            <Area type="monotone" dataKey="backlog" stroke="#f59e0b" strokeWidth={2}
              fill="url(#liveBacklogGrad)" dot={false} connectNulls />
          </AreaChart>
        </Panel>
      </div>

      {/* row 2: latency percentile charts with stats */}
      <div className={`grid gap-3 ${hasE2E ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <Panel title="Publish latency percentiles" footer={<StatsRow points={points} which="pub" />}>
          <LineChart data={points} margin={MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis dataKey="t" tickFormatter={fmtTime} tickCount={6} tick={TICK} label={XLABEL} />
            <YAxis tick={TICK} width={48}
              label={{ value: 'ms', angle: -90, position: 'insideLeft', offset: 10, fill: '#475569', fontSize: 10 }} />
            <Tooltip contentStyle={TT_STYLE} labelFormatter={s => `t = ${fmtTime(s as number)}`}
              formatter={(v, n) => [`${v} ms`, n]} />
            <Legend wrapperStyle={{ fontSize: '10px', color: '#94a3b8', paddingTop: '4px' }} />
            {LAT_KEYS.map(k => (
              <Line key={k.label} type="monotone" dataKey={k.pub} name={k.label}
                stroke={k.color} dot={false} strokeWidth={k.label.startsWith('p99') ? 2 : 1.5} connectNulls />
            ))}
          </LineChart>
        </Panel>

        {hasE2E && (
          <Panel title="E2E latency percentiles" footer={<StatsRow points={points} which="e2e" />}>
            <LineChart data={points} margin={MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
              <XAxis dataKey="t" tickFormatter={fmtTime} tickCount={6} tick={TICK} label={XLABEL} />
              <YAxis tick={TICK} width={48}
                label={{ value: 'ms', angle: -90, position: 'insideLeft', offset: 10, fill: '#475569', fontSize: 10 }} />
              <Tooltip contentStyle={TT_STYLE} labelFormatter={s => `t = ${fmtTime(s as number)}`}
                formatter={(v, n) => [`${v} ms`, n]} />
              <Legend wrapperStyle={{ fontSize: '10px', color: '#94a3b8', paddingTop: '4px' }} />
              {LAT_KEYS.map(k => (
                <Line key={k.label} type="monotone" dataKey={k.e2e} name={k.label}
                  stroke={k.color} dot={false} strokeWidth={k.label.startsWith('p99') ? 2 : 1.5} connectNulls />
              ))}
            </LineChart>
          </Panel>
        )}
      </div>
    </div>
  )
}
