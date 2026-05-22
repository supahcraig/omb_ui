import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { Run } from '@/api/types'

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    running: 'bg-blue-900 text-blue-300 border border-blue-600',
    completed: 'bg-emerald-900 text-emerald-300 border border-emerald-700',
    failed: 'bg-red-900 text-red-300 border border-red-700',
    pending: 'bg-slate-700 text-slate-400',
    cancelled: 'bg-slate-700 text-slate-400',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[status] ?? colors.pending}`}>
      {status}
    </span>
  )
}

function fmtSeconds(seconds: number | null | undefined): string {
  if (seconds == null) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

function elapsedSeconds(startedAt: string): number {
  return Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
}

function computeBestWorst(runs: Run[], key: (r: Run) => number | null | undefined) {
  const vals = runs
    .filter(r => r.status === 'completed')
    .map(r => ({ id: r.id, val: key(r) }))
    .filter(x => x.val != null) as { id: number; val: number }[]
  if (vals.length < 2) return { best: null, worst: null }
  const sorted = [...vals].sort((a, b) => a.val - b.val)
  return { best: sorted[0].id, worst: sorted[sorted.length - 1].id }
}

export default function SweepDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: sweep } = useQuery({
    queryKey: ['sweep', id],
    queryFn: () => api.getSweep(Number(id)),
    refetchInterval: (query) =>
      query.state.data?.status === 'running' ? 3000 : false,
  })

  const cancelMutation = useMutation({
    mutationFn: () => api.cancelSweep(Number(id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sweep', id] }),
  })

  if (!sweep) {
    return <div className="p-6 text-slate-400">Loading…</div>
  }

  const paramKeys = Object.keys(sweep.parameter_axes)
  const currentRun = sweep.runs.find(r => r.status === 'running')
  const pct = sweep.run_count > 0 ? Math.round((sweep.completed_count / sweep.run_count) * 100) : 0

  // Best/worst per metric
  // For latency: lower is better → best = lowest (sorted[0]), worst = highest (sorted[last])
  // For rate: higher is better → best = highest (sorted[last]), worst = lowest (sorted[0])
  const pubP99BW = computeBestWorst(sweep.runs, r => r.metrics?.publish_latency_p99)
  const e2eBW = computeBestWorst(sweep.runs, r => r.metrics?.end_to_end_latency_p99)
  const rateBW = computeBestWorst(sweep.runs, r => r.metrics?.publish_rate_avg)
  // latency: best = low, worst = high (already correct from computeBestWorst)
  const pubP99Best = pubP99BW.best
  const pubP99Worst = pubP99BW.worst
  const e2eBest = e2eBW.best
  const e2eWorst = e2eBW.worst
  // rate: best = high, worst = low → swap
  const rateBest = rateBW.worst
  const rateWorst = rateBW.best

  function metricCls(runId: number, best: number | null, worst: number | null): string {
    if (runId === best) return 'text-emerald-400 font-semibold'
    if (runId === worst) return 'text-red-400'
    return 'text-slate-200 font-medium'
  }

  function fmt(v: number | null | undefined, decimals = 1): string {
    return v != null ? v.toFixed(decimals) : '—'
  }

  function fmtRate(v: number | null | undefined): string {
    return v != null ? `${Math.round(v).toLocaleString()}/s` : '—'
  }

  const currentParams = currentRun?.sweep_params
    ? Object.entries(currentRun.sweep_params).map(([k, v]) => `${k}=${v}`).join(' · ')
    : null

  return (
    <div className="p-6 max-w-6xl space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-semibold text-slate-100">{sweep.name}</h1>
            <StatusBadge status={sweep.status} />
          </div>
          <p className="text-sm text-slate-400">
            Started {fmtDate(sweep.started_at)} · {sweep.completed_count} of {sweep.run_count} runs complete
            {sweep.status === 'running' && sweep.est_seconds_remaining != null &&
              ` · est. ${fmtSeconds(sweep.est_seconds_remaining)} remaining`
            }
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => navigate('/sweeps/new', { state: { from: sweep } })}
            className="border border-slate-600 text-slate-300 hover:bg-slate-800 text-sm px-4 py-1.5 rounded-md transition-colors"
          >
            Duplicate
          </button>
          {sweep.status === 'running' && (
            <button
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              className="border border-red-700 text-red-400 hover:bg-red-950 text-sm px-4 py-1.5 rounded-md transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          )}
          <button
            onClick={() => navigate('/sweeps')}
            className="border border-slate-600 text-slate-400 hover:text-slate-200 text-sm px-4 py-1.5 rounded-md transition-colors"
          >
            ← All Sweeps
          </button>
        </div>
      </div>

      {/* Progress card */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-4">
        <div className="flex justify-between items-center mb-2">
          <div className="text-sm text-slate-300">
            {currentRun
              ? <>Run {sweep.runs.indexOf(currentRun) + 1} of {sweep.run_count}
                  {currentParams && <> &nbsp;—&nbsp; <span className="text-indigo-300 font-mono text-xs">{currentParams}</span></>}
                </>
              : sweep.status === 'completed' ? 'All runs complete' : 'Waiting…'
            }
          </div>
          <span className="text-sm text-slate-400">{pct}%</span>
        </div>
        <div className="w-full h-2 bg-slate-900 rounded-full overflow-hidden">
          <div
            className={`h-2 rounded-full transition-all ${sweep.status === 'completed' ? 'bg-emerald-500' : 'bg-indigo-500'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex gap-5 mt-3 text-xs text-slate-500">
          <span>elapsed <span className="text-slate-400">{fmtSeconds(elapsedSeconds(sweep.started_at))}</span></span>
          <span>remaining <span className="text-slate-400">{fmtSeconds(sweep.est_seconds_remaining)}</span></span>
          <span>cooldown <span className="text-slate-400">{sweep.cooldown_seconds}s</span></span>
          <span>failed <span className="text-slate-400">{sweep.failed_count}</span></span>
        </div>
      </div>

      {/* Comparison table */}
      <div className="overflow-x-auto rounded-lg border border-slate-700">
        <table className="w-full text-sm">
          <thead className="bg-slate-800 text-slate-400 text-xs uppercase tracking-wider">
            <tr>
              <th className="px-3 py-3 text-left w-8">#</th>
              {paramKeys.map(k => (
                <th key={k} className="px-3 py-3 text-left font-mono">{k}</th>
              ))}
              <th className="px-3 py-3 text-right">Publish Rate</th>
              <th className="px-3 py-3 text-right">Pub p99</th>
              <th className="px-3 py-3 text-right">E2E p99</th>
              <th className="px-3 py-3 text-left">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {sweep.runs.map((run, idx) => {
              const isPending = run.status === 'pending'
              const isRunning = run.status === 'running'
              const clickable = !isPending
              const rowCls = [
                isRunning ? 'bg-slate-800/60' : isPending ? 'opacity-40' : '',
                clickable ? 'cursor-pointer hover:bg-slate-800' : '',
                'transition-colors',
              ].join(' ')
              return (
                <tr
                  key={run.id}
                  className={rowCls}
                  onClick={() => clickable && navigate(`/runs/${run.id}`)}
                >
                  <td className="px-3 py-2.5 text-slate-500">{idx + 1}</td>
                  {paramKeys.map(k => (
                    <td key={k} className="px-3 py-2.5 font-mono text-indigo-300 text-xs">
                      {run.sweep_params?.[k] ?? '—'}
                    </td>
                  ))}
                  <td className={`px-3 py-2.5 text-right font-mono text-xs ${isPending || isRunning ? 'text-slate-600' : metricCls(run.id, rateBest, rateWorst)}`}>
                    {isPending || isRunning ? '—' : fmtRate(run.metrics?.publish_rate_avg)}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono text-xs ${isPending || isRunning ? 'text-slate-600' : metricCls(run.id, pubP99Best, pubP99Worst)}`}>
                    {isPending || isRunning ? '—' : fmt(run.metrics?.publish_latency_p99)}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-mono text-xs ${isPending || isRunning ? 'text-slate-600' : metricCls(run.id, e2eBest, e2eWorst)}`}>
                    {isPending || isRunning ? '—' : fmt(run.metrics?.end_to_end_latency_p99)}
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={run.status} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
