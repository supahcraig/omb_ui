import { useState, useCallback } from 'react'
import jsYaml from 'js-yaml'
import DriverForm from './DriverForm'
import WorkloadForm from './WorkloadForm'
import YamlEditor from './YamlEditor'
import { Input } from '@/components/ui/input'
import type { DriverConfig, WorkloadConfig } from '@/api/types'

interface Props {
  driver: DriverConfig
  workload: WorkloadConfig
  prometheusUrl: string
  prometheusUsername: string
  prometheusPassword: string
  onDriverChange: (d: DriverConfig) => void
  onWorkloadChange: (w: WorkloadConfig) => void
  onPrometheusUrlChange: (url: string) => void
  onPrometheusUsernameChange: (v: string) => void
  onPrometheusPasswordChange: (v: string) => void
}

function toDriverYaml(d: DriverConfig): string {
  const sections = ['topicConfig','commonConfig','producerConfig','consumerConfig'] as const
  const raw: Record<string, unknown> = {
    driverClass: d.driverClass,
    replicationFactor: d.replicationFactor,
    reset: d.reset,
  }
  for (const s of sections) {
    const kv = d[s]
    raw[s] = Object.entries(kv).map(([k,v]) => `${k}=${v}`).join('\n') + (Object.keys(kv).length ? '\n' : '')
  }
  return jsYaml.dump(raw, { lineWidth: -1 })
}

function fromDriverYaml(text: string): DriverConfig | null {
  try {
    const data = jsYaml.load(text) as Record<string, unknown>
    const parseKv = (block: unknown): Record<string,string> => {
      const result: Record<string,string> = {}
      for (const line of String(block ?? '').split('\n')) {
        const eq = line.indexOf('=')
        if (eq > 0) result[line.slice(0,eq).trim()] = line.slice(eq+1).trim()
      }
      return result
    }
    return {
      driverClass: String(data.driverClass ?? ''),
      replicationFactor: Number(data.replicationFactor ?? 3),
      reset: Boolean(data.reset ?? true),
      topicConfig: parseKv(data.topicConfig),
      commonConfig: parseKv(data.commonConfig),
      producerConfig: parseKv(data.producerConfig),
      consumerConfig: parseKv(data.consumerConfig),
    }
  } catch (_e) { return null }
}

export default function ConfigEditor({ driver, workload, prometheusUrl, prometheusUsername, prometheusPassword, onDriverChange, onWorkloadChange, onPrometheusUrlChange, onPrometheusUsernameChange, onPrometheusPasswordChange }: Props) {
  const [driverYaml, setDriverYaml] = useState(() => toDriverYaml(driver))
  const [workloadYaml, setWorkloadYaml] = useState(() => jsYaml.dump(workload, { lineWidth: -1 }))

  const handleDriverFormChange = useCallback((d: DriverConfig) => {
    onDriverChange(d)
    setDriverYaml(toDriverYaml(d))
  }, [onDriverChange])

  const handleDriverYamlChange = useCallback((text: string) => {
    setDriverYaml(text)
    const parsed = fromDriverYaml(text)
    if (parsed) onDriverChange(parsed)
  }, [onDriverChange])

  const handleWorkloadFormChange = useCallback((w: WorkloadConfig) => {
    onWorkloadChange(w)
    setWorkloadYaml(jsYaml.dump(w, { lineWidth: -1 }))
  }, [onWorkloadChange])

  const handleWorkloadYamlChange = useCallback((text: string) => {
    setWorkloadYaml(text)
    try {
      const parsed = jsYaml.load(text) as WorkloadConfig
      if (parsed && typeof parsed === 'object') onWorkloadChange(parsed)
    } catch (_e) { /* ignore invalid YAML mid-edit */ }
  }, [onWorkloadChange])

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Connection row */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <span className="text-xs font-semibold text-indigo-400 uppercase tracking-wider whitespace-nowrap">Prometheus</span>
        <Input
          className="w-72 bg-slate-900 border-slate-700 h-7 text-sm font-mono"
          value={prometheusUrl}
          onChange={e => onPrometheusUrlChange(e.target.value)}
          placeholder="http://localhost:9644"
        />
        <Input
          className="w-32 bg-slate-900 border-slate-700 h-7 text-sm"
          value={prometheusUsername}
          onChange={e => onPrometheusUsernameChange(e.target.value)}
          placeholder="username"
        />
        <Input
          type="password"
          className="w-32 bg-slate-900 border-slate-700 h-7 text-sm"
          value={prometheusPassword}
          onChange={e => onPrometheusPasswordChange(e.target.value)}
          placeholder="password"
        />
      </div>
      {/* Forms row — scrollable, takes natural height up to 3/5 of space */}
      <div className="flex-[3] min-h-0 grid grid-cols-2 gap-6 overflow-hidden">
        <div className="flex flex-col min-h-0">
          <div className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-2">Workload</div>
          <div className="flex-1 overflow-y-auto min-h-0 pr-1">
            <WorkloadForm value={workload} onChange={handleWorkloadFormChange} />
          </div>
        </div>
        <div className="flex flex-col min-h-0">
          <div className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-2">Driver</div>
          <div className="flex-1 overflow-y-auto min-h-0 pr-1">
            <DriverForm value={driver} onChange={handleDriverFormChange} />
          </div>
        </div>
      </div>

      {/* YAML row — takes 2/5 of space */}
      <div className="flex-[2] min-h-0 grid grid-cols-2 gap-6">
        <div className="flex flex-col min-h-0">
          <div className="text-xs text-slate-500 font-mono mb-1">workload.yaml</div>
          <div className="flex-1 min-h-0">
            <YamlEditor value={workloadYaml} onChange={handleWorkloadYamlChange} />
          </div>
        </div>
        <div className="flex flex-col min-h-0">
          <div className="text-xs text-slate-500 font-mono mb-1">driver.yaml</div>
          <div className="flex-1 min-h-0">
            <YamlEditor value={driverYaml} onChange={handleDriverYamlChange} />
          </div>
        </div>
      </div>
    </div>
  )
}
