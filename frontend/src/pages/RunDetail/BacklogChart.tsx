import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts'

interface BacklogTimeseries {
  backlog: number[]
  sample_rate_ms: number
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const TICK     = { fill: '#94a3b8', fontSize: 12 }
const GRID     = '#1e293b'
const TT_STYLE = { background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', fontSize: '12px' }

export default function BacklogChart({ timeseries }: { timeseries: BacklogTimeseries }) {
  const data = timeseries.backlog.map((v, i) => ({
    t: Math.round((i * timeseries.sample_rate_ms) / 1000),
    backlog: Math.max(0, v),
  }))

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm font-medium text-slate-300">Consumer backlog over time</span>
        <span className="text-[10px] font-medium px-1.5 py-px rounded uppercase tracking-wide bg-slate-800 text-slate-500 border border-slate-700">OMB</span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 24 }}>
          <defs>
            <linearGradient id="backlogGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={GRID} />
          <XAxis
            dataKey="t"
            tickFormatter={fmtTime}
            tickCount={9}
            tick={TICK}
            label={{ value: 'elapsed (mm:ss)', position: 'insideBottom', offset: -12, fill: '#94a3b8', fontSize: 12 }}
          />
          <YAxis
            tick={TICK}
            width={65}
            tickFormatter={v => (v as number).toLocaleString()}
            label={{ value: 'messages', angle: -90, position: 'insideLeft', offset: 10, fill: '#94a3b8', fontSize: 12 }}
          />
          <Tooltip
            contentStyle={TT_STYLE}
            labelFormatter={s => `t = ${fmtTime(s as number)}`}
            formatter={v => [(v as number).toLocaleString(), 'backlog']}
          />
          <Area
            type="monotone"
            dataKey="backlog"
            stroke="#f59e0b"
            strokeWidth={2}
            fill="url(#backlogGrad)"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
