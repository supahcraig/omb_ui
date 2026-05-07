import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { api } from '@/api/client'
import MetricsTiles from './MetricsTiles'
import LatencyBars from './LatencyBars'

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>()
  const runId = Number(id)

  const { data: run, isLoading } = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.getRun(runId),
    refetchInterval: (query) => query.state.data?.status === 'running' ? 3000 : false,
  })

  if (isLoading) return <div className="text-slate-400">Loading…</div>
  if (!run) return <div className="text-red-400">Run not found</div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Run #{run.id} {run.name ? `— ${run.name}` : ''}</h1>
          <p className="text-slate-400 text-sm mt-1">
            {new Date(run.started_at).toLocaleString()}
            {run.completed_at && ` → ${new Date(run.completed_at).toLocaleString()}`}
            {' · '}<span className="capitalize">{run.status}</span>
          </p>
        </div>
        <Link to="/runs">
          <Button variant="outline" size="sm">← All Results</Button>
        </Link>
      </div>

      {run.metrics && (
        <>
          <MetricsTiles metrics={run.metrics} />
          <div className="bg-slate-900 border border-slate-700 rounded-lg p-5">
            <LatencyBars metrics={run.metrics} />
          </div>
        </>
      )}

      {run.status === 'running' && (
        <div className="bg-indigo-900/30 border border-indigo-700 rounded-lg p-4 text-indigo-300 text-sm">
          Run in progress — metrics will appear when complete.
        </div>
      )}

      {/* Config snapshot */}
      <details className="bg-slate-900 border border-slate-700 rounded-lg">
        <summary className="px-5 py-3 cursor-pointer text-sm text-slate-400 hover:text-white">
          Config used for this run ▸
        </summary>
        <div className="px-5 pb-4 grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-indigo-400 uppercase tracking-wider mb-2">Driver</div>
            <pre className="text-xs text-slate-300 overflow-auto max-h-64 bg-slate-950 p-3 rounded">
              {JSON.stringify(run.driver_config, null, 2)}
            </pre>
          </div>
          <div>
            <div className="text-xs text-indigo-400 uppercase tracking-wider mb-2">Workload</div>
            <pre className="text-xs text-slate-300 overflow-auto max-h-64 bg-slate-950 p-3 rounded">
              {JSON.stringify(run.workload_config, null, 2)}
            </pre>
          </div>
        </div>
      </details>
    </div>
  )
}
