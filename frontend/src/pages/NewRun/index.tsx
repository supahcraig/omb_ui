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
  replicationFactor: 3,
  reset: true,
  topicConfig: {},
  commonConfig: {
    'bootstrap.servers': 'broker:9092',
    'security.protocol': 'SASL_SSL',
    'sasl.mechanism': 'SCRAM-SHA-256',
    'sasl.jaas.config': "org.apache.kafka.common.security.scram.ScramLoginModule required username='user' password='pass';",
    'request.timeout.ms': '120000',
  },
  producerConfig: {
    'acks': 'all',
    'linger.ms': '1',
    'batch.size': '131072',
    'compression.type': 'none',
  },
  consumerConfig: {
    'group.id': 'benchGroup',
    'auto.offset.reset': 'earliest',
    'enable.auto.commit': 'false',
    'fetch.min.bytes': '1',
    'fetch.max.wait.ms': '50',
    'max.partition.fetch.bytes': '10485760',
  },
}
const DEFAULT_WORKLOAD: WorkloadConfig = {
  topics: 1, partitionsPerTopic: 10,
  messageSize: 1024, payloadFile: 'payload/payload-1Kb.data',
  subscriptionsPerTopic: 1, consumerPerSubscription: 1,
  producersPerTopic: 10, producerRate: 10000,
  consumerBacklogSizeGB: 0, testDurationMinutes: 20, warmupDurationMinutes: 5,
}

export default function NewRunPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [runName, setRunName] = useState('')
  const [driver, setDriver] = useState<DriverConfig>(DEFAULT_DRIVER)
  const [workload, setWorkload] = useState<WorkloadConfig>(DEFAULT_WORKLOAD)
  const [prometheusUrl, setPrometheusUrl] = useState('http://localhost:9644')
  const [prometheusUsername, setPrometheusUsername] = useState('')
  const [prometheusPassword, setPrometheusPassword] = useState('')
  const [activeRunId, setActiveRunId] = useState<number | null>(null)

  // Load current config from disk on mount
  const { data: configData } = useQuery({
    queryKey: ['config'],
    queryFn: api.getConfig,
  })

  // Apply config data when it loads, merging with defaults so missing disk sections don't blank the form
  useEffect(() => {
    if (configData) {
      const d = configData.driver ?? {}
      setDriver({
        ...DEFAULT_DRIVER,
        ...d,
        topicConfig:    { ...DEFAULT_DRIVER.topicConfig,    ...(d.topicConfig    ?? {}) },
        commonConfig:   { ...DEFAULT_DRIVER.commonConfig,   ...(d.commonConfig   ?? {}) },
        producerConfig: { ...DEFAULT_DRIVER.producerConfig, ...(d.producerConfig ?? {}) },
        consumerConfig: { ...DEFAULT_DRIVER.consumerConfig, ...(d.consumerConfig ?? {}) },
      })
      setWorkload({ ...DEFAULT_WORKLOAD, ...(configData.workload ?? {}) })
      if (configData.prometheus_url) setPrometheusUrl(configData.prometheus_url)
      if (configData.prometheus_username) setPrometheusUsername(configData.prometheus_username)
      if (configData.prometheus_password) setPrometheusPassword(configData.prometheus_password)
    }
  }, [configData])

  const saveMutation = useMutation({
    mutationFn: () => api.putConfig({ driver, workload, prometheus_url: prometheusUrl, prometheus_username: prometheusUsername, prometheus_password: prometheusPassword }),
  })

  const runMutation = useMutation({
    mutationFn: async () => {
      await api.putConfig({ driver, workload, prometheus_url: prometheusUrl, prometheus_username: prometheusUsername, prometheus_password: prometheusPassword })
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
          key={configData ? 1 : 0}
          driver={driver}
          workload={workload}
          prometheusUrl={prometheusUrl}
          prometheusUsername={prometheusUsername}
          prometheusPassword={prometheusPassword}
          onDriverChange={setDriver}
          onWorkloadChange={setWorkload}
          onPrometheusUrlChange={setPrometheusUrl}
          onPrometheusUsernameChange={setPrometheusUsername}
          onPrometheusPasswordChange={setPrometheusPassword}
        />
      </div>
    </div>
  )
}
