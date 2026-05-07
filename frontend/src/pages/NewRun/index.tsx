import { useState, useCallback, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api } from '@/api/client'
import type { DriverConfig, WorkloadConfig } from '@/api/types'
import ConfigEditor from './ConfigEditor'
import LiveRun from './LiveRun'

const DEFAULT_DRIVER: DriverConfig = {
  driverClass: 'io.openmessaging.benchmark.driver.redpanda.RedpandaBenchmarkDriver',
  replicationFactor: 3, reset: true,
  topicConfig: {}, commonConfig: {}, producerConfig: {}, consumerConfig: {},
}
const DEFAULT_WORKLOAD: WorkloadConfig = {
  topics: 1, partitionsPerTopic: 10, messageSize: 1024,
  payloadFile: 'payload/payload-1Kb.data', subscriptionsPerTopic: 1,
  consumerPerSubscription: 1, producersPerTopic: 10, producerRate: 10000,
  consumerBacklogSizeGB: 0, testDurationMinutes: 20, warmupDurationMinutes: 5,
}

export default function NewRunPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [runName, setRunName] = useState('')
  const [driver, setDriver] = useState<DriverConfig>(DEFAULT_DRIVER)
  const [workload, setWorkload] = useState<WorkloadConfig>(DEFAULT_WORKLOAD)
  const [activeRunId, setActiveRunId] = useState<number | null>(null)

  // Load current config from disk on mount
  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn: api.getConfig,
  })

  // Apply config data when it loads
  useEffect(() => {
    if (configData) {
      setDriver(configData.driver)
      setWorkload(configData.workload)
    }
  }, [configData])

  const saveMutation = useMutation({
    mutationFn: () => api.putConfig({ driver, workload }),
  })

  const runMutation = useMutation({
    mutationFn: async () => {
      await api.putConfig({ driver, workload })
      return api.createRun(runName || undefined)
    },
    onSuccess: (run) => setActiveRunId(run.id),
  })

  const handleComplete = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['runs'] })
  }, [queryClient])

  const handleStop = useCallback(() => {
    setActiveRunId(null)
    queryClient.invalidateQueries({ queryKey: ['runs'] })
  }, [queryClient])

  if (activeRunId !== null) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Run #{activeRunId} in progress</h1>
          <Button variant="outline" size="sm" onClick={() => navigate(`/runs/${activeRunId}`)}>
            View Details →
          </Button>
        </div>
        <LiveRun
          runId={activeRunId}
          warmupMinutes={workload.warmupDurationMinutes}
          testMinutes={workload.testDurationMinutes}
          onComplete={handleComplete}
          onStop={handleStop}
        />
      </div>
    )
  }

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between flex-shrink-0">
        <h1 className="text-xl font-semibold">New Run</h1>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Label className="text-slate-400 text-sm">Label (optional)</Label>
            <Input className="w-48 bg-slate-900 border-slate-700 h-8"
              placeholder="e.g. batch=64k linger=5ms"
              value={runName} onChange={e => setRunName(e.target.value)} />
          </div>
          <Button variant="outline" size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}>
            {saveMutation.isPending ? 'Saving…' : 'Save Config'}
          </Button>
          <Button size="sm"
            onClick={() => runMutation.mutate()}
            disabled={runMutation.isPending}
            className="bg-indigo-600 hover:bg-indigo-500">
            {runMutation.isPending ? 'Starting…' : '▶ Run'}
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <ConfigEditor
          driver={driver}
          workload={workload}
          onDriverChange={setDriver}
          onWorkloadChange={setWorkload}
        />
      </div>
    </div>
  )
}
