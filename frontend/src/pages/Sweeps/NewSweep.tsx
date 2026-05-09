import { useState, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { api } from '@/api/client'
import type { SweepDetail } from '@/api/types'

interface AxisRow { id: number; name: string; values: string[]; input: string }

function ChipInput({ row, onChange }: { row: AxisRow; onChange: (r: AxisRow) => void }) {
  return (
    <div className="flex items-start gap-2 flex-1">
      <input
        className="bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-xs font-mono text-slate-200 w-36 focus:outline-none focus:border-indigo-500"
        placeholder="param.name"
        value={row.name}
        onChange={(e) => onChange({ ...row, name: e.target.value })}
      />
      <div className="flex-1 flex flex-wrap gap-1 items-center bg-slate-800 border border-slate-600 rounded px-2 py-1 min-h-[32px]">
        {row.values.map((v, i) => (
          <span key={i} className="bg-indigo-900 text-indigo-300 text-xs font-mono px-2 py-0.5 rounded flex items-center gap-1">
            {v}
            <button
              type="button"
              className="text-indigo-400 hover:text-white ml-0.5"
              onClick={() => onChange({ ...row, values: row.values.filter((_, j) => j !== i) })}
            >×</button>
          </span>
        ))}
        <input
          className="bg-transparent text-xs font-mono text-slate-200 outline-none w-24 placeholder-slate-600"
          placeholder="value + ↵"
          value={row.input}
          onChange={(e) => onChange({ ...row, input: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && row.input.trim()) {
              e.preventDefault()
              onChange({ ...row, values: [...row.values, row.input.trim()], input: '' })
            }
          }}
        />
      </div>
    </div>
  )
}

let _id = 0
function newRow(): AxisRow { return { id: ++_id, name: '', values: [], input: '' } }

export default function NewSweepPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const sourceSweep = (location.state as { from?: SweepDetail } | null)?.from
  const { data: savedConfig } = useQuery({ queryKey: ['config'], queryFn: api.getConfig })

  const [name, setName] = useState('')
  const [cooldown, setCooldown] = useState(60)
  const [testDuration, setTestDuration] = useState(20)
  const [warmupDuration, setWarmupDuration] = useState(5)
  const [producerRate, setProducerRate] = useState(10000)
  const [messageSize, setMessageSize] = useState(1024)
  const [partitions, setPartitions] = useState(10)

  const [driverClass, setDriverClass] = useState('io.openmessaging.benchmark.driver.redpanda.RedpandaBenchmarkDriver')
  const [bootstrapServers, setBootstrapServers] = useState('')
  const [replicationFactor, setReplicationFactor] = useState(3)
  const [compressionType, setCompressionType] = useState('none')
  const [requestTimeout, setRequestTimeout] = useState('120000')
  const [securityProtocol, setSecurityProtocol] = useState('')
  const [saslMechanism, setSaslMechanism] = useState('')
  const [saslJaasConfig, setSaslJaasConfig] = useState('')

  useEffect(() => {
    if (sourceSweep) {
      const firstRun = sourceSweep.runs?.[0]
      const d = firstRun?.driver_config
      const w = firstRun?.workload_config
      setName(`Copy of ${sourceSweep.name}`)
      setCooldown(sourceSweep.cooldown_seconds)
      if (d) {
        if (d.driverClass) setDriverClass(d.driverClass)
        setBootstrapServers(d.commonConfig['bootstrap.servers'] ?? '')
        setReplicationFactor(d.replicationFactor)
        setCompressionType(d.producerConfig['compression.type'] ?? 'none')
        setRequestTimeout(d.commonConfig['request.timeout.ms'] ?? '120000')
        setSecurityProtocol(d.commonConfig['security.protocol'] ?? '')
        setSaslMechanism(d.commonConfig['sasl.mechanism'] ?? '')
        setSaslJaasConfig(d.commonConfig['sasl.jaas.config'] ?? '')
      }
      if (w) {
        setTestDuration(w.testDurationMinutes)
        setWarmupDuration(w.warmupDurationMinutes)
        setProducerRate(w.producerRate)
        setMessageSize(w.messageSize)
        setPartitions(w.partitionsPerTopic)
      }
      const axesFromSweep = Object.entries(sourceSweep.parameter_axes).map(([name, values]) => ({
        id: ++_id,
        name,
        values,
        input: '',
      }))
      if (axesFromSweep.length > 0) setAxes(axesFromSweep)
      return
    }
    if (!savedConfig) return
    const d = savedConfig.driver
    const w = savedConfig.workload
    if (d.driverClass) setDriverClass(d.driverClass)
    setBootstrapServers(d.commonConfig['bootstrap.servers'] ?? '')
    setReplicationFactor(d.replicationFactor)
    setCompressionType(d.producerConfig['compression.type'] ?? 'none')
    setRequestTimeout(d.commonConfig['request.timeout.ms'] ?? '120000')
    setSecurityProtocol(d.commonConfig['security.protocol'] ?? '')
    setSaslMechanism(d.commonConfig['sasl.mechanism'] ?? '')
    setSaslJaasConfig(d.commonConfig['sasl.jaas.config'] ?? '')
    setTestDuration(w.testDurationMinutes)
    setWarmupDuration(w.warmupDurationMinutes)
    setProducerRate(w.producerRate)
    setMessageSize(w.messageSize)
    setPartitions(w.partitionsPerTopic)
  }, [savedConfig, sourceSweep])

  const [axes, setAxes] = useState<AxisRow[]>([newRow()])

  const updateRow = (id: number, updated: AxisRow) =>
    setAxes(rows => rows.map(r => r.id === id ? updated : r))
  const removeRow = (id: number) =>
    setAxes(rows => rows.filter(r => r.id !== id))

  const validAxes = axes.filter(r => r.name.trim() && r.values.length > 0)
  const combinationCount = validAxes.reduce((acc, r) => acc * r.values.length, 1)
  const estimatedMinutes = combinationCount * (testDuration + warmupDuration + cooldown / 60)

  const mutation = useMutation({
    mutationFn: api.createSweep,
    onSuccess: (sweep) => navigate(`/sweeps/${sweep.id}`),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const parameterAxes: Record<string, string[]> = {}
    for (const row of validAxes) {
      parameterAxes[row.name.trim()] = row.values
    }
    const commonConfig: Record<string, string> = {
      'bootstrap.servers': bootstrapServers,
      'request.timeout.ms': requestTimeout,
    }
    if (securityProtocol) commonConfig['security.protocol'] = securityProtocol
    if (saslMechanism) commonConfig['sasl.mechanism'] = saslMechanism
    if (saslJaasConfig) commonConfig['sasl.jaas.config'] = saslJaasConfig

    mutation.mutate({
      name,
      parameter_axes: parameterAxes,
      cooldown_seconds: cooldown,
      workload_config: {
        testDurationMinutes: testDuration,
        warmupDurationMinutes: warmupDuration,
        producerRate,
        messageSize,
        partitionsPerTopic: partitions,
      },
      driver_base_config: {
        driverClass,
        replicationFactor,
        commonConfig,
        producerConfig: { 'compression.type': compressionType },
        consumerConfig: {},
        topicConfig: {},
      },
    })
  }

  function fmtTime(minutes: number): string {
    const h = Math.floor(minutes / 60)
    const m = Math.round(minutes % 60)
    if (h > 0) return `${h}h ${m}m`
    return `${m}m`
  }

  function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-xs text-slate-400 uppercase tracking-wide">{label}</label>
        {children}
      </div>
    )
  }

  const inputCls = "bg-slate-800 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-indigo-500"
  const sectionCls = "bg-slate-900 border border-slate-700 rounded-lg p-5 space-y-4"

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-100">{sourceSweep ? 'Duplicate Sweep' : 'New Sweep'}</h1>
        <p className="text-sm text-slate-400 mt-0.5">
          {sourceSweep ? `Copying from "${sourceSweep.name}"` : 'Run a Cartesian-product parameter sweep'}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Section 1: Sweep */}
        <div className={sectionCls}>
          <h2 className="text-sm font-medium text-slate-300 uppercase tracking-wide">Sweep</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Name">
              <input className={inputCls} value={name} onChange={e => setName(e.target.value)} required placeholder="e.g. acks + batch.size tuning" />
            </Field>
            <Field label="Cooldown (seconds)">
              <input className={inputCls} type="number" min={0} value={cooldown} onChange={e => setCooldown(Number(e.target.value))} />
            </Field>
          </div>
        </div>

        {/* Section 2: Workload */}
        <div className={sectionCls}>
          <h2 className="text-sm font-medium text-slate-300 uppercase tracking-wide">Workload</h2>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Test Duration (min)">
              <input className={inputCls} type="number" min={1} value={testDuration} onChange={e => setTestDuration(Number(e.target.value))} />
            </Field>
            <Field label="Warmup Duration (min)">
              <input className={inputCls} type="number" min={0} value={warmupDuration} onChange={e => setWarmupDuration(Number(e.target.value))} />
            </Field>
            <Field label="Producer Rate (msg/s)">
              <input className={inputCls} type="number" min={1} value={producerRate} onChange={e => setProducerRate(Number(e.target.value))} />
            </Field>
            <Field label="Message Size (bytes)">
              <input className={inputCls} type="number" min={1} value={messageSize} onChange={e => setMessageSize(Number(e.target.value))} />
            </Field>
            <Field label="Partitions per Topic">
              <input className={inputCls} type="number" min={1} value={partitions} onChange={e => setPartitions(Number(e.target.value))} />
            </Field>
          </div>
        </div>

        {/* Section 3: Driver base settings */}
        <div className={sectionCls}>
          <h2 className="text-sm font-medium text-slate-300 uppercase tracking-wide">Driver Base Settings</h2>
          <div className="grid grid-cols-2 gap-4">
            <Field label="bootstrap.servers">
              <input className={`${inputCls} font-mono text-xs`} value={bootstrapServers} onChange={e => setBootstrapServers(e.target.value)} />
            </Field>
            <Field label="replicationFactor">
              <input className={inputCls} type="number" min={1} value={replicationFactor} onChange={e => setReplicationFactor(Number(e.target.value))} />
            </Field>
            <Field label="compression.type">
              <input className={`${inputCls} font-mono text-xs`} value={compressionType} onChange={e => setCompressionType(e.target.value)} />
            </Field>
            <Field label="request.timeout.ms">
              <input className={`${inputCls} font-mono text-xs`} value={requestTimeout} onChange={e => setRequestTimeout(e.target.value)} />
            </Field>
            <Field label="security.protocol">
              <input className={`${inputCls} font-mono text-xs`} value={securityProtocol} onChange={e => setSecurityProtocol(e.target.value)} />
            </Field>
            <Field label="sasl.mechanism">
              <input className={`${inputCls} font-mono text-xs`} value={saslMechanism} onChange={e => setSaslMechanism(e.target.value)} />
            </Field>
            <div className="col-span-2">
              <Field label="sasl.jaas.config">
                <input className={`${inputCls} font-mono text-xs w-full`} value={saslJaasConfig} onChange={e => setSaslJaasConfig(e.target.value)} />
              </Field>
            </div>
          </div>
        </div>

        {/* Section 4: Swept parameters */}
        <div className={sectionCls}>
          <h2 className="text-sm font-medium text-slate-300 uppercase tracking-wide">Swept Parameters</h2>
          <div className="space-y-2">
            {axes.map(row => (
              <div key={row.id} className="flex items-start gap-2">
                <ChipInput row={row} onChange={(r) => updateRow(row.id, r)} />
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  className="text-slate-500 hover:text-red-400 text-lg leading-none mt-1.5"
                  title="Remove parameter"
                >×</button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setAxes(rows => [...rows, newRow()])}
            className="text-indigo-400 hover:text-indigo-300 text-sm mt-2"
          >
            + Add parameter
          </button>
        </div>

        {/* Live summary */}
        <div className={`${sectionCls} bg-slate-800`}>
          <div className="flex items-center justify-between">
            <div className="flex gap-6 text-sm">
              <span className="text-slate-400">
                Combinations: <span className="text-slate-100 font-medium">{combinationCount}</span>
              </span>
              <span className="text-slate-400">
                Est. total: <span className="text-slate-100 font-medium">{fmtTime(estimatedMinutes)}</span>
              </span>
            </div>
            {combinationCount > 12 && (
              <span className="text-amber-400 text-xs">⚠ Large sweep — consider fewer values</span>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={mutation.isPending || !name.trim() || validAxes.length === 0}
            className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-6 py-2 rounded-md text-sm font-medium transition-colors"
          >
            {mutation.isPending ? 'Creating…' : 'Create Sweep'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/sweeps')}
            className="text-slate-400 hover:text-slate-200 px-4 py-2 rounded-md text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
        {mutation.isError && (
          <p className="text-red-400 text-sm">{String(mutation.error)}</p>
        )}
      </form>
    </div>
  )
}
