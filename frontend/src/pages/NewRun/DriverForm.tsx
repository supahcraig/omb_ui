import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { DriverConfig } from '@/api/types'

interface Props {
  value: DriverConfig
  onChange: (updated: DriverConfig) => void
}

function KvField({ label, value, onChange }: {
  label: string; value: string; onChange: (v: string) => void
}) {
  return (
    <div>
      <Label className="text-xs text-slate-400 uppercase tracking-wide">{label}</Label>
      <Input className="mt-1 bg-slate-900 border-slate-700 text-slate-100 font-mono text-xs"
        value={value} onChange={e => onChange(e.target.value)} />
    </div>
  )
}

function setCommon(value: DriverConfig, key: string, val: string): DriverConfig {
  return { ...value, commonConfig: { ...value.commonConfig, [key]: val } }
}
function setProducer(value: DriverConfig, key: string, val: string): DriverConfig {
  return { ...value, producerConfig: { ...value.producerConfig, [key]: val } }
}
function setConsumer(value: DriverConfig, key: string, val: string): DriverConfig {
  return { ...value, consumerConfig: { ...value.consumerConfig, [key]: val } }
}

export default function DriverForm({ value, onChange }: Props) {
  return (
    <div className="space-y-6">
      <div>
        <div className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-3">Connection</div>
        <div className="grid grid-cols-1 gap-3">
          <KvField label="Bootstrap Servers"
            value={value.commonConfig['bootstrap.servers'] ?? ''}
            onChange={v => onChange(setCommon(value, 'bootstrap.servers', v))} />
          <KvField label="Security Protocol"
            value={value.commonConfig['security.protocol'] ?? ''}
            onChange={v => onChange(setCommon(value, 'security.protocol', v))} />
          <KvField label="SASL Mechanism"
            value={value.commonConfig['sasl.mechanism'] ?? ''}
            onChange={v => onChange(setCommon(value, 'sasl.mechanism', v))} />
          <KvField label="SASL JAAS Config"
            value={value.commonConfig['sasl.jaas.config'] ?? ''}
            onChange={v => onChange(setCommon(value, 'sasl.jaas.config', v))} />
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-3">Producer</div>
        <div className="grid grid-cols-2 gap-3">
          <KvField label="acks"
            value={value.producerConfig['acks'] ?? ''}
            onChange={v => onChange(setProducer(value, 'acks', v))} />
          <KvField label="linger.ms"
            value={value.producerConfig['linger.ms'] ?? ''}
            onChange={v => onChange(setProducer(value, 'linger.ms', v))} />
          <KvField label="batch.size"
            value={value.producerConfig['batch.size'] ?? ''}
            onChange={v => onChange(setProducer(value, 'batch.size', v))} />
          <KvField label="compression.type"
            value={value.producerConfig['compression.type'] ?? ''}
            onChange={v => onChange(setProducer(value, 'compression.type', v))} />
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-3">Consumer</div>
        <div className="grid grid-cols-2 gap-3">
          <KvField label="group.id"
            value={value.consumerConfig['group.id'] ?? ''}
            onChange={v => onChange(setConsumer(value, 'group.id', v))} />
          <KvField label="auto.offset.reset"
            value={value.consumerConfig['auto.offset.reset'] ?? ''}
            onChange={v => onChange(setConsumer(value, 'auto.offset.reset', v))} />
          <KvField label="fetch.max.wait.ms"
            value={value.consumerConfig['fetch.max.wait.ms'] ?? ''}
            onChange={v => onChange(setConsumer(value, 'fetch.max.wait.ms', v))} />
          <KvField label="max.partition.fetch.bytes"
            value={value.consumerConfig['max.partition.fetch.bytes'] ?? ''}
            onChange={v => onChange(setConsumer(value, 'max.partition.fetch.bytes', v))} />
        </div>
      </div>

      <div>
        <div className="text-xs font-semibold text-indigo-400 uppercase tracking-wider mb-3">Topic</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs text-slate-400 uppercase tracking-wide">Replication Factor</Label>
            <Input className="mt-1 bg-slate-900 border-slate-700 text-slate-100" type="number"
              value={value.replicationFactor}
              onChange={e => onChange({ ...value, replicationFactor: Number(e.target.value) })} />
          </div>
        </div>
      </div>
    </div>
  )
}
