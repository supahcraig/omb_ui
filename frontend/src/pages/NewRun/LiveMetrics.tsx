import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceArea,
} from 'recharts'

export interface LivePoint {
  t: number
  pubRate:  number | null
  pubMBs:   number | null
  consRate: number | null
  consMBs:  number | null
  backlog:  number | null
  pubP50:   number | null
  pubP99:   number | null
  pubP999:  number | null
  e2eP50:   number | null
  e2eP99:   number | null
  e2eP999:  number | null
}

export type LiveMetricState = LivePoint[]

export type ParsedOmbLine =
  | { kind: 'pub' } & Omit<LivePoint, 't'>
  | { kind: 'e2e'; e2eP50: number | null; e2eP99: number | null; e2eP999: number | null }

export function parseOmbLine(line: string): ParsedOmbLine | null {
  let m: RegExpMatchArray | null

  if (line.includes('E2E Latency')) {
    const r = { kind: 'e2e' as const, e2eP50: null as number | null, e2eP99: null as number | null, e2eP999: null as number | null }
    m = line.match(/\b50%:\s*([\d.]+)/);  if (m) r.e2eP50  = parseFloat(m[1])
    m = line.match(/\b99%:\s*([\d.]+)/);  if (m) r.e2eP99  = parseFloat(m[1])
    m = line.match(/99\.9%:\s*([\d.]+)/); if (m) r.e2eP999 = parseFloat(m[1])
    return r
  }

  if (!line.includes('Pub rate')) return null

  const r = {
    kind: 'pub' as const,
    pubRate: null as number | null, pubMBs: null as number | null,
    consRate: null as number | null, consMBs: null as number | null,
    backlog: null as number | null,
    pubP50: null as number | null, pubP99: null as number | null, pubP999: null as number | null,
    e2eP50: null as number | null, e2eP99: null as number | null, e2eP999: null as number | null,
  }

  m = line.match(/Pub rate\s+([\d.]+)\s+msg\/s\s+\/\s+([\d.]+)\s+MB\/s/)
  if (m) { r.pubRate = parseFloat(m[1]); r.pubMBs = parseFloat(m[2]) }

  m = line.match(/Cons rate\s+([\d.]+)\s+msg\/s\s+\/\s+([\d.]+)\s+MB\/s/)
  if (m) { r.consRate = parseFloat(m[1]); r.consMBs = parseFloat(m[2]) }

  // Store full message count, not K-multiple
  m = line.match(/Backlog:\s*([\d.]+)\s*K/)
  if (m) r.backlog = Math.max(0, Math.round(parseFloat(m[1]) * 1000))

  const pubSec = line.match(/Pub Latency[^|]*/)?.[0] ?? ''
  if (pubSec) {
    m = pubSec.match(/\b50%:\s*([\d.]+)/);  if (m) r.pubP50  = parseFloat(m[1])
    m = pubSec.match(/\b99%:\s*([\d.]+)/);  if (m) r.pubP99  = parseFloat(m[1])
    m = pubSec.match(/99\.9%:\s*([\d.]+)/); if (m) r.pubP999 = parseFloat(m[1])
  }

  return r
}

// ── chart constants ──────────────────────────────────────────────────────────

const fmtTime  = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const TICK     = { fill: '#94a3b8', fontSize: 12 }
const GRID     = '#1e293b'
const TT_STYLE = { background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', fontSize: '12px' }
const MARGIN   = { top: 5, right: 16, left: 8, bottom: 22 }
const XLABEL   = { value: 'elapsed (mm:ss)', position: 'insideBottom' as const, offset: -10, fill: '#94a3b8', fontSize: 12 }

const LAT_KEYS: Array<{ label: string; pub: keyof LivePoint; e2e: keyof LivePoint; color: string }> = [
  { label: 'p50',   pub: 'pubP50',  e2e: 'e2eP50',  color: '#10b981' },
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

function StatsRow({ points, which, warmupSecs }: { points: LivePoint[]; which: 'pub' | 'e2e'; warmupSecs: number }) {
  const testPoints = warmupSecs > 0 ? points.filter(p => p.t >= warmupSecs) : points
  return (
    <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-800 pt-2">
      {LAT_KEYS.map(({ label, pub, e2e, color }) => {
        const s = pctStats(testPoints, which === 'pub' ? pub : e2e)
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

const SOURCE_BADGE = {
  omb:      'bg-slate-800 text-slate-500 border border-slate-700',
  redpanda: 'bg-red-900/40 text-red-400 border border-red-800/60',
}

function Panel({ title, children, footer, height = 160, source }: {
  title: string; children: React.ReactNode; footer?: React.ReactNode; height?: number; source?: keyof typeof SOURCE_BADGE
}) {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-slate-400">{title}</span>
        {source && (
          <span className={`text-[10px] font-medium px-1.5 py-px rounded uppercase tracking-wide ${SOURCE_BADGE[source]}`}>
            {source === 'redpanda' ? 'Redpanda' : 'OMB'}
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={height}>{children as React.ReactElement}</ResponsiveContainer>
      {footer}
    </div>
  )
}

// ── component ────────────────────────────────────────────────────────────────

const WARMUP_AREA = (warmupSecs: number) => warmupSecs > 0
  ? <ReferenceArea x1={0} x2={warmupSecs} fill="#6366f1" fillOpacity={0.07}
      label={{ value: 'warmup', position: 'insideTopLeft', fill: '#6366f1', fontSize: 10 }} />
  : null

interface Props { points: LivePoint[]; warmupSecs: number }

export default function LiveMetrics({ points, warmupSecs }: Props) {
  return (
    <div className="space-y-3">
      {/* row 1: throughput msg/s + MB/s + backlog */}
      <div className="grid grid-cols-3 gap-3">
        <Panel title="Throughput (msg/s)" source="omb">
          <LineChart data={points} margin={MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis dataKey="t" tickFormatter={fmtTime} tickCount={6} tick={TICK} label={XLABEL} />
            <YAxis tick={TICK} width={60} tickFormatter={v => (v as number).toLocaleString()}
              label={{ value: 'msg/s', angle: -90, position: 'insideLeft', offset: 10, fill: '#94a3b8', fontSize: 12 }} />
            <Tooltip contentStyle={TT_STYLE} labelFormatter={s => `t = ${fmtTime(s as number)}`}
              formatter={v => [(v as number).toLocaleString(), '']} />
            <Legend wrapperStyle={{ fontSize: '12px', color: '#94a3b8', paddingTop: '4px' }} />
            {WARMUP_AREA(warmupSecs)}
            <Line type="monotone" dataKey="pubRate"  name="pub rate"  stroke="#6366f1" dot={false} strokeWidth={2} connectNulls />
            <Line type="monotone" dataKey="consRate" name="cons rate" stroke="#10b981" dot={false} strokeWidth={2} connectNulls />
          </LineChart>
        </Panel>

        <Panel title="Throughput (MB/s)" source="omb">
          <LineChart data={points} margin={MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis dataKey="t" tickFormatter={fmtTime} tickCount={6} tick={TICK} label={XLABEL} />
            <YAxis tick={TICK} width={48} tickFormatter={v => `${(v as number).toFixed(0)}`}
              label={{ value: 'MB/s', angle: -90, position: 'insideLeft', offset: 10, fill: '#94a3b8', fontSize: 12 }} />
            <Tooltip contentStyle={TT_STYLE} labelFormatter={s => `t = ${fmtTime(s as number)}`}
              formatter={v => [`${(v as number).toFixed(1)} MB/s`, '']} />
            <Legend wrapperStyle={{ fontSize: '12px', color: '#94a3b8', paddingTop: '4px' }} />
            {WARMUP_AREA(warmupSecs)}
            <Line type="monotone" dataKey="pubMBs"  name="pub MB/s"  stroke="#6366f1" dot={false} strokeWidth={2} connectNulls />
            <Line type="monotone" dataKey="consMBs" name="cons MB/s" stroke="#10b981" dot={false} strokeWidth={2} connectNulls />
          </LineChart>
        </Panel>

        <Panel title="Consumer backlog" source="omb">
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
              label={{ value: 'messages', angle: -90, position: 'insideLeft', offset: 10, fill: '#94a3b8', fontSize: 12 }} />
            <Tooltip contentStyle={TT_STYLE} labelFormatter={s => `t = ${fmtTime(s as number)}`}
              formatter={v => [(v as number).toLocaleString(), 'backlog']} />
            {WARMUP_AREA(warmupSecs)}
            <Area type="monotone" dataKey="backlog" stroke="#f59e0b" strokeWidth={2}
              fill="url(#liveBacklogGrad)" dot={false} connectNulls />
          </AreaChart>
        </Panel>
      </div>

      {/* row 2: latency percentile charts with stats */}
      <div className="grid grid-cols-2 gap-3">
        <Panel title="Publish latency percentiles" height={220} source="omb" footer={<StatsRow points={points} which="pub" warmupSecs={warmupSecs} />}>
          <LineChart data={points} margin={MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis dataKey="t" tickFormatter={fmtTime} tickCount={6} tick={TICK} label={XLABEL} />
            <YAxis tick={TICK} width={48}
              label={{ value: 'ms', angle: -90, position: 'insideLeft', offset: 10, fill: '#94a3b8', fontSize: 12 }} />
            <Tooltip contentStyle={TT_STYLE} labelFormatter={s => `t = ${fmtTime(s as number)}`}
              formatter={(v, n) => [`${v} ms`, n]} />
            <Legend wrapperStyle={{ fontSize: '12px', color: '#94a3b8', paddingTop: '4px' }} />
            {WARMUP_AREA(warmupSecs)}
            {LAT_KEYS.map(k => (
              <Line key={k.label} type="monotone" dataKey={k.pub} name={k.label}
                stroke={k.color} dot={false} strokeWidth={k.label.startsWith('p99') ? 2 : 1.5} connectNulls />
            ))}
          </LineChart>
        </Panel>

        <Panel title="E2E latency percentiles" height={220} source="omb" footer={<StatsRow points={points} which="e2e" warmupSecs={warmupSecs} />}>
          <LineChart data={points} margin={MARGIN}>
            <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
            <XAxis dataKey="t" tickFormatter={fmtTime} tickCount={6} tick={TICK} label={XLABEL} />
            <YAxis tick={TICK} width={48}
              label={{ value: 'ms', angle: -90, position: 'insideLeft', offset: 10, fill: '#94a3b8', fontSize: 12 }} />
            <Tooltip contentStyle={TT_STYLE} labelFormatter={s => `t = ${fmtTime(s as number)}`}
              formatter={(v, n) => [`${v} ms`, n]} />
            <Legend wrapperStyle={{ fontSize: '12px', color: '#94a3b8', paddingTop: '4px' }} />
            {WARMUP_AREA(warmupSecs)}
            {LAT_KEYS.map(k => (
              <Line key={k.label} type="monotone" dataKey={k.e2e} name={k.label}
                stroke={k.color} dot={false} strokeWidth={k.label.startsWith('p99') ? 2 : 1.5} connectNulls />
            ))}
          </LineChart>
        </Panel>
      </div>
    </div>
  )
}
