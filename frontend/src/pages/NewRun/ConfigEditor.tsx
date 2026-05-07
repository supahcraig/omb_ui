import { useState, useCallback } from 'react'
import jsYaml from 'js-yaml'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import DriverForm from './DriverForm'
import WorkloadForm from './WorkloadForm'
import YamlEditor from './YamlEditor'
import type { DriverConfig, WorkloadConfig } from '@/api/types'

interface Props {
  driver: DriverConfig
  workload: WorkloadConfig
  onDriverChange: (d: DriverConfig) => void
  onWorkloadChange: (w: WorkloadConfig) => void
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

export default function ConfigEditor({ driver, workload, onDriverChange, onWorkloadChange }: Props) {
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
    <Tabs defaultValue="workload" className="h-full flex flex-col">
      <TabsList className="bg-slate-800 border-b border-slate-700">
        <TabsTrigger value="workload" className="data-[state=active]:bg-slate-700">Workload</TabsTrigger>
        <TabsTrigger value="driver" className="data-[state=active]:bg-slate-700">Driver</TabsTrigger>
      </TabsList>

      <TabsContent value="workload" className="flex-1 grid grid-cols-2 gap-4 mt-0 min-h-0">
        <div className="overflow-y-auto pr-2">
          <WorkloadForm value={workload} onChange={handleWorkloadFormChange} />
        </div>
        <div className="min-h-0">
          <YamlEditor value={workloadYaml} onChange={handleWorkloadYamlChange} />
        </div>
      </TabsContent>

      <TabsContent value="driver" className="flex-1 grid grid-cols-2 gap-4 mt-0 min-h-0">
        <div className="overflow-y-auto pr-2">
          <DriverForm value={driver} onChange={handleDriverFormChange} />
        </div>
        <div className="min-h-0">
          <YamlEditor value={driverYaml} onChange={handleDriverYamlChange} />
        </div>
      </TabsContent>
    </Tabs>
  )
}
