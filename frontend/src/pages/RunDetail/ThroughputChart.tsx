import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

interface Timeseries {
  publish_rate: number[]
  consume_rate: number[]
  sample_rate_ms: number
}

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

const TICK  = { fill: '#94a3b8', fontSize: 12 }
const GRID  = '#1e293b'
const TT_STYLE = { background: '#1e293b', border: '1px solid #334155', borderRadius: '6px', fontSize: '12px' }

export default function ThroughputChart({ timeseries }: { timeseries: Timeseries }) {
  const data = timeseries.publish_rate.map((rate, i) => ({
    t: Math.round((i * timeseries.sample_rate_ms) / 1000),
    publish: Math.round(rate),
    consume: Math.round(timeseries.consume_rate[i] ?? 0),
  }))

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-sm font-medium text-slate-300">Throughput over time</span>
        <span className="text-[10px] font-medium px-1.5 py-px rounded uppercase tracking-wide bg-slate-800 text-slate-500 border border-slate-700">OMB</span>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 24 }}>
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
            tickFormatter={v => v.toLocaleString()}
            label={{ value: 'msg/s', angle: -90, position: 'insideLeft', offset: 10, fill: '#94a3b8', fontSize: 12 }}
          />
          <Tooltip
            contentStyle={TT_STYLE}
            labelFormatter={s => `t = ${fmtTime(s as number)}`}
            formatter={(v) => [(v as number).toLocaleString(), '']}
          />
          <Legend wrapperStyle={{ fontSize: '12px', color: '#94a3b8', paddingTop: '8px' }} />
          <Line type="monotone" dataKey="publish" name="publish rate" stroke="#6366f1" dot={false} strokeWidth={2} />
          <Line type="monotone" dataKey="consume" name="consume rate" stroke="#10b981" dot={false} strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
