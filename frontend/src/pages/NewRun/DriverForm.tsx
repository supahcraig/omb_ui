import { Input } from '@/components/ui/input'
import type { DriverConfig } from '@/api/types'

const COMPRESSION_TYPES = ['none', 'gzip', 'snappy', 'lz4', 'zstd'] as const
const ACKS_OPTIONS      = ['0', '1', 'all'] as const

const LABEL  = 'shrink-0 w-48 text-xs text-slate-400 font-mono'
const NUM    = 'w-24 bg-slate-900 border-slate-700 text-slate-100 h-7 text-sm'
const SHORT  = 'w-36 bg-slate-900 border-slate-700 text-slate-100 h-7 text-sm font-mono text-xs'
const MED    = 'w-56 bg-slate-900 border-slate-700 text-slate-100 h-7 text-sm font-mono text-xs'

const SEL    = 'bg-slate-900 border border-slate-700 text-slate-100 rounded-md px-2 py-1 text-sm font-mono h-7 focus:outline-none focus:ring-2 focus:ring-indigo-500'
const ROW    = 'flex items-center gap-3'
const HDR    = 'text-xs font-semibold text-indigo-400 uppercase tracking-wider pt-2'

function setCommon(value: DriverConfig, key: string, val: string): DriverConfig {
  return { ...value, commonConfig: { ...value.commonConfig, [key]: val } }
}
function setProducer(value: DriverConfig, key: string, val: string): DriverConfig {
  return { ...value, producerConfig: { ...value.producerConfig, [key]: val } }
}
function setConsumer(value: DriverConfig, key: string, val: string): DriverConfig {
  return { ...value, consumerConfig: { ...value.consumerConfig, [key]: val } }
}

interface DriverFormProps {
  value: DriverConfig
  onChange: (d: DriverConfig) => void
  saslUsername: string
  saslPassword: string
  onSaslUsernameChange: (v: string) => void
  onSaslPasswordChange: (v: string) => void
}

export default function DriverForm({ value, onChange, saslUsername, saslPassword, onSaslUsernameChange, onSaslPasswordChange }: DriverFormProps) {
  return (
    <div className="space-y-2">
      <div className={HDR}>Connection</div>
      <div className={ROW}><span className={LABEL}>bootstrap.servers</span>
        <Input className={MED} value={value.commonConfig['bootstrap.servers'] ?? ''}
          onChange={e => onChange(setCommon(value, 'bootstrap.servers', e.target.value))} /></div>
      <div className={ROW}><span className={LABEL}>security.protocol</span>
        <Input className={SHORT} value={value.commonConfig['security.protocol'] ?? ''}
          onChange={e => onChange(setCommon(value, 'security.protocol', e.target.value))} /></div>
      <div className={ROW}><span className={LABEL}>sasl.mechanism</span>
        <Input className={SHORT} value={value.commonConfig['sasl.mechanism'] ?? ''}
          onChange={e => onChange(setCommon(value, 'sasl.mechanism', e.target.value))} /></div>
      <div className={ROW}><span className={LABEL}>sasl.username</span>
        <Input className={MED} value={saslUsername}
          onChange={e => onSaslUsernameChange(e.target.value)} /></div>
      <div className={ROW}><span className={LABEL}>sasl.password</span>
        <Input type="password" className={MED} value={saslPassword}
          onChange={e => onSaslPasswordChange(e.target.value)} /></div>
      <div className={ROW}><span className={LABEL}>request.timeout.ms</span>
        <Input className={NUM} value={value.commonConfig['request.timeout.ms'] ?? ''}
          onChange={e => onChange(setCommon(value, 'request.timeout.ms', e.target.value))} /></div>

      <div className={HDR}>Producer</div>
      <div className={ROW}><span className={LABEL}>acks</span>
        <select className={`w-20 ${SEL}`}
          value={value.producerConfig['acks'] ?? 'all'}
          onChange={e => onChange(setProducer(value, 'acks', e.target.value))}
        >
          {ACKS_OPTIONS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>
      <div className={ROW}><span className={LABEL}>linger.ms</span>
        <Input className={NUM} value={value.producerConfig['linger.ms'] ?? ''}
          onChange={e => onChange(setProducer(value, 'linger.ms', e.target.value))} /></div>
      <div className={ROW}><span className={LABEL}>batch.size</span>
        <Input className={NUM} value={value.producerConfig['batch.size'] ?? ''}
          onChange={e => onChange(setProducer(value, 'batch.size', e.target.value))} /></div>
      <div className={ROW}><span className={LABEL}>compression.type</span>
        <select className={`w-28 ${SEL}`}
          value={value.producerConfig['compression.type'] ?? 'none'}
          onChange={e => onChange(setProducer(value, 'compression.type', e.target.value))}
        >
          {COMPRESSION_TYPES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className={HDR}>Consumer</div>
      <div className={ROW}><span className={LABEL}>group.id</span>
        <Input className={SHORT} value={value.consumerConfig['group.id'] ?? ''}
          onChange={e => onChange(setConsumer(value, 'group.id', e.target.value))} /></div>
      <div className={ROW}><span className={LABEL}>auto.offset.reset</span>
        <Input className={SHORT} value={value.consumerConfig['auto.offset.reset'] ?? ''}
          onChange={e => onChange(setConsumer(value, 'auto.offset.reset', e.target.value))} /></div>
      <div className={ROW}><span className={LABEL}>enable.auto.commit</span>
        <select className={`w-20 ${SEL}`}
          value={value.consumerConfig['enable.auto.commit'] ?? 'false'}
          onChange={e => onChange(setConsumer(value, 'enable.auto.commit', e.target.value))}
        >
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      </div>
      <div className={ROW}><span className={LABEL}>fetch.min.bytes</span>
        <Input className={NUM} value={value.consumerConfig['fetch.min.bytes'] ?? ''}
          onChange={e => onChange(setConsumer(value, 'fetch.min.bytes', e.target.value))} /></div>
      <div className={ROW}><span className={LABEL}>fetch.max.wait.ms</span>
        <Input className={NUM} value={value.consumerConfig['fetch.max.wait.ms'] ?? ''}
          onChange={e => onChange(setConsumer(value, 'fetch.max.wait.ms', e.target.value))} /></div>
      <div className={ROW}><span className={LABEL}>max.partition.fetch.bytes</span>
        <Input className={NUM} value={value.consumerConfig['max.partition.fetch.bytes'] ?? ''}
          onChange={e => onChange(setConsumer(value, 'max.partition.fetch.bytes', e.target.value))} /></div>

      <div className={HDR}>Topic</div>
      <div className={ROW}><span className={LABEL}>replicationFactor</span>
        <Input className={NUM} value={value.replicationFactor}
          onChange={e => onChange({ ...value, replicationFactor: Number(e.target.value) })} /></div>
    </div>
  )
}
