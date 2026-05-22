import { useParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { api } from '@/api/client'
import MetricsTiles from './MetricsTiles'
import LatencyBars from './LatencyBars'
import ThroughputChart from './ThroughputChart'
import BacklogChart from './BacklogChart'
import PrometheusCharts from './PrometheusCharts'
import LiveRun from '../NewRun/LiveRun'

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>()
  const runId = Number(id)
  const queryClient = useQueryClient()

  const wasRunning = useRef(false)
  const [liveLines, setLiveLines] = useState<string[]>([])
  const logRef = useRef<HTMLDivElement>(null)

  const handleLines = useCallback((lines: string[]) => setLiveLines(lines), [])

  const { data: run, isLoading } = useQuery({
    queryKey: ['run', runId],
    queryFn: () => api.getRun(runId),
    refetchInterval: (query) => query.state.data?.status === 'running' ? 3000 : false,
  })

  useEffect(() => {
    if (run?.status === 'running') wasRunning.current = true
  }, [run?.status])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [liveLines])

  if (isLoading) return <div className="text-slate-400">Loading…</div>
  if (!run) return <div className="text-red-400">Run not found</div>

  const showLive = run.status === 'running' || wasRunning.current

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Run #{run.id}{run.name ? ` — ${run.name}` : ''}</h1>
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

      {showLive && (
        <LiveRun
          runId={run.id}
          warmupMinutes={run.workload_config.warmupDurationMinutes}
          testMinutes={run.workload_config.testDurationMinutes}
          initialElapsed={Math.max(0, Math.floor((Date.now() - new Date(run.started_at + 'Z').getTime()) / 1000))}
          onComplete={() => {
            queryClient.invalidateQueries({ queryKey: ['run', runId] })
            queryClient.invalidateQueries({ queryKey: ['prometheus', runId] })
          }}
          onStop={() => {
            queryClient.invalidateQueries({ queryKey: ['run', runId] })
            queryClient.invalidateQueries({ queryKey: ['prometheus', runId] })
          }}
          onLines={handleLines}
        />
      )}

      {run.metrics && <MetricsTiles metrics={run.metrics} />}

      {/* Post-run timeseries charts only when we didn't watch this run live
          (if we did, the live charts already show throughput and backlog) */}
      {!showLive && run.metrics?.throughput_timeseries && (
        <ThroughputChart timeseries={run.metrics.throughput_timeseries} />
      )}
      {!showLive && run.metrics?.backlog_timeseries && (
        <BacklogChart timeseries={run.metrics.backlog_timeseries} />
      )}

      {run.status !== 'pending' && (
        <PrometheusCharts runId={run.id} isRunning={run.status === 'running'} />
      )}

      {run.metrics && (
        <div className="bg-slate-900 border border-slate-700 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm font-medium text-slate-300">Latency summary</span>
            <span className="text-[10px] font-medium px-1.5 py-px rounded uppercase tracking-wide bg-slate-800 text-slate-500 border border-slate-700">OMB</span>
          </div>
          <LatencyBars metrics={run.metrics} />
        </div>
      )}

      {showLive && liveLines.length > 0 && (
        <div
          ref={logRef}
          className="bg-slate-950 border border-slate-700 rounded p-3 h-48 overflow-y-auto font-mono text-xs text-slate-300 space-y-0.5"
        >
          {liveLines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
          ))}
          {run.status === 'running' && <div className="text-slate-600 animate-pulse">▌</div>}
        </div>
      )}

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
