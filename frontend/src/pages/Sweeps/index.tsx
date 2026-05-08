import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '@/api/client'
import type { Sweep } from '@/api/types'

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: 'bg-blue-900 text-blue-300 border border-blue-600',
    completed: 'bg-emerald-900 text-emerald-300 border border-emerald-700',
    failed: 'bg-red-900 text-red-300 border border-red-700',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status] ?? colors.failed}`}>
      {status}
    </span>
  )
}

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0
  const done = completed === total && total > 0
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-1.5 rounded-full ${done ? 'bg-emerald-500' : 'bg-indigo-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-slate-500">{completed} / {total}</span>
    </div>
  )
}

function fmtRemaining(seconds: number | null): string {
  if (seconds == null) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h > 0) return `~${h}h ${m}m`
  return `~${m}m`
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diffDays === 1) return 'yesterday'
  return `${diffDays} days ago`
}

export default function SweepsPage() {
  const navigate = useNavigate()
  const { data: sweeps = [] } = useQuery({
    queryKey: ['sweeps'],
    queryFn: api.listSweeps,
    refetchInterval: (query) =>
      query.state.data?.some((s: Sweep) => s.status === 'running') ? 5000 : false,
  })

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Sweeps</h1>
          <p className="text-sm text-slate-400 mt-0.5">Parameter sweep history</p>
        </div>
        <button
          onClick={() => navigate('/sweeps/new')}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm px-4 py-2 rounded-md transition-colors"
        >
          + New Sweep
        </button>
      </div>

      <div className="rounded-lg border border-slate-700 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 text-slate-400 text-xs uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3 text-left">Name</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Progress</th>
              <th className="px-4 py-3 text-left">Parameters swept</th>
              <th className="px-4 py-3 text-left">Started</th>
              <th className="px-4 py-3 text-left">Est. remaining</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {sweeps.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No sweeps yet — create one to compare parameter combinations
                </td>
              </tr>
            )}
            {sweeps.map((sweep) => (
              <tr
                key={sweep.id}
                className="hover:bg-slate-800 cursor-pointer transition-colors"
                onClick={() => navigate(`/sweeps/${sweep.id}`)}
              >
                <td className="px-4 py-3 text-indigo-400 font-medium hover:underline">
                  {sweep.name}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={sweep.status} />
                </td>
                <td className="px-4 py-3">
                  <ProgressBar completed={sweep.completed_count} total={sweep.run_count} />
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-400">
                  {Object.keys(sweep.parameter_axes).join(' · ')}
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs">
                  {fmtDate(sweep.started_at)}
                </td>
                <td className="px-4 py-3 text-slate-500 text-xs">
                  {sweep.status === 'running' ? fmtRemaining(sweep.est_seconds_remaining) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
