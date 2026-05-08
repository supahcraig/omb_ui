import { useNavigate } from 'react-router-dom'
import type { RunListItem } from '@/api/types'

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: 'bg-emerald-900 text-emerald-300',
    running: 'bg-indigo-900 text-indigo-300 animate-pulse',
    failed: 'bg-red-900 text-red-300',
    pending: 'bg-slate-700 text-slate-300',
    cancelled: 'bg-slate-700 text-slate-400',
  }
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status] ?? colors.pending}`}>{status}</span>
}

function fmt(v: number | null | undefined, decimals = 1): string {
  return v != null ? v.toFixed(decimals) : '—'
}

interface Props { runs: RunListItem[] }

export default function RunTable({ runs }: Props) {
  const navigate = useNavigate()
  return (
    <div className="rounded-lg border border-slate-700 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-800 text-slate-400 text-xs uppercase tracking-wider">
          <tr>
            <th className="px-4 py-3 text-left">#</th>
            <th className="px-4 py-3 text-left">Label</th>
            <th className="px-4 py-3 text-left">Status</th>
            <th className="px-4 py-3 text-left">Started</th>
            <th className="px-4 py-3 text-right">Pub Rate</th>
            <th className="px-4 py-3 text-right">p99 (ms)</th>
            <th className="px-4 py-3 text-right">p99.9 (ms)</th>
            <th className="px-4 py-3 text-right">E2E p99 (ms)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {runs.length === 0 && (
            <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500">No runs yet — start one from New Run</td></tr>
          )}
          {runs.map(run => (
            <tr key={run.id}
              className="hover:bg-slate-800 cursor-pointer transition-colors"
              onClick={() => navigate(`/runs/${run.id}`)}>
              <td className="px-4 py-3 text-slate-400">{run.id}</td>
              <td className="px-4 py-3 text-slate-200">
                {run.name ?? <span className="text-slate-500">—</span>}
                {run.sweep_id != null && (
                  <span
                    className="ml-2 inline-block bg-indigo-950 border border-indigo-800 text-indigo-400 text-xs px-1.5 py-0 rounded cursor-pointer hover:bg-indigo-900"
                    onClick={(e) => { e.stopPropagation(); navigate(`/sweeps/${run.sweep_id}`) }}
                  >
                    ↗ Sweep #{run.sweep_id}
                  </span>
                )}
              </td>
              <td className="px-4 py-3"><StatusBadge status={run.status} /></td>
              <td className="px-4 py-3 text-slate-400">{new Date(run.started_at).toLocaleString()}</td>
              <td className="px-4 py-3 text-right font-mono text-slate-300">
                {run.publish_rate_avg != null ? `${Math.round(run.publish_rate_avg).toLocaleString()}/s` : '—'}
              </td>
              <td className="px-4 py-3 text-right font-mono text-emerald-400">{fmt(run.publish_latency_p99)}</td>
              <td className="px-4 py-3 text-right font-mono text-amber-400">{fmt(run.publish_latency_p999)}</td>
              <td className="px-4 py-3 text-right font-mono text-slate-300">{fmt(run.end_to_end_latency_p99)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
