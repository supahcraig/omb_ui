import { Input } from '@/components/ui/input'
import type { WorkloadConfig } from '@/api/types'
import { calculateRates } from './rateCalculator'

function pickPayloadFile(bytes: number): string {
  for (const s of PAYLOAD_SIZES) {
    if (bytes <= s.bytes) return s.file
  }
  return PAYLOAD_SIZES[PAYLOAD_SIZES.length - 1].file
}

interface Props {
  value: WorkloadConfig
  onChange: (updated: WorkloadConfig) => void
}

const KEY_DISTRIBUTORS = ['NO_KEY', 'RANDOM_DISTRIBUTOR', 'KEY_ROUND_ROBIN'] as const

// OMB ships these payload files; messageSize must not exceed file size
const PAYLOAD_SIZES = [
  { label: '1 KB',   bytes: 1_024,      file: 'payload/payload-1Kb.data'   },
  { label: '10 KB',  bytes: 10_240,     file: 'payload/payload-10Kb.data'  },
  { label: '100 KB', bytes: 102_400,    file: 'payload/payload-100Kb.data' },
  { label: '1 MB',   bytes: 1_048_576,  file: 'payload/payload-1Mb.data'   },
] as const

const LABEL = 'shrink-0 w-52 text-xs text-slate-400 uppercase tracking-wide'
const NUM   = 'w-24 bg-slate-900 border-slate-700 text-slate-100 h-7 text-sm'
const ROW   = 'flex items-center gap-3'

export default function WorkloadForm({ value, onChange }: Props) {
  const set = (key: keyof WorkloadConfig) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const numeric = ['topics','partitionsPerTopic','messageSize','subscriptionsPerTopic',
      'consumerPerSubscription','producersPerTopic','producerRate','consumerBacklogSizeGB',
      'testDurationMinutes','warmupDurationMinutes']
    const val = e.target.value
    onChange({ ...value, [key]: numeric.includes(key) ? Number(val) : val })
  }

  const rates = calculateRates({
    producerRate: value.producerRate,
    topics: value.topics,
    messageSize: value.messageSize,
    subscriptionsPerTopic: value.subscriptionsPerTopic,
    warmupDurationMinutes: value.warmupDurationMinutes,
    testDurationMinutes: value.testDurationMinutes,
  })

  return (
    <div className="space-y-2">
      <div className={ROW}><span className={LABEL}>Topics</span>
        <Input className={NUM} value={value.topics} onChange={set('topics')} /></div>
      <div className={ROW}><span className={LABEL}>Partitions / topic</span>
        <Input className={NUM} value={value.partitionsPerTopic} onChange={set('partitionsPerTopic')} /></div>
      <div className={ROW}>
        <span className={LABEL}>Message size</span>
        <div className="flex items-center gap-1">
          {PAYLOAD_SIZES.map(s => (
            <button key={s.bytes} type="button"
              className={`px-2 py-0.5 text-xs rounded border transition-colors ${
                value.messageSize === s.bytes
                  ? 'border-indigo-500 text-indigo-300 bg-indigo-900/30'
                  : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-300'
              }`}
              onClick={() => onChange({ ...value, messageSize: s.bytes, payloadFile: s.file })}
            >{s.label}</button>
          ))}
          <Input
            className="w-28 bg-slate-900 border-slate-700 text-slate-100 h-7 text-sm ml-1"
            value={value.messageSize}
            onChange={e => {
              const bytes = Number(e.target.value)
              onChange({ ...value, messageSize: bytes, payloadFile: pickPayloadFile(bytes) })
            }}
          />
          <span className="text-xs text-slate-500">bytes</span>
        </div>
      </div>
      <div className={ROW}><span className={LABEL}>Producer rate (msg/s)</span>
        <Input className={NUM} value={value.producerRate} onChange={set('producerRate')} /></div>
      <div className={ROW}><span className={LABEL}>Producers / topic</span>
        <Input className={NUM} value={value.producersPerTopic} onChange={set('producersPerTopic')} /></div>
      <div className={ROW}><span className={LABEL}>Subscriptions / topic</span>
        <Input className={NUM} value={value.subscriptionsPerTopic} onChange={set('subscriptionsPerTopic')} /></div>
      <div className={ROW}><span className={LABEL}>Consumers / subscription</span>
        <Input className={NUM} value={value.consumerPerSubscription} onChange={set('consumerPerSubscription')} /></div>
      <div className={ROW}><span className={LABEL}>Consumer backlog (GB)</span>
        <Input className={NUM} value={value.consumerBacklogSizeGB} onChange={set('consumerBacklogSizeGB')} /></div>
      <div className={ROW}><span className={LABEL}>Warmup (min)</span>
        <Input className={NUM} value={value.warmupDurationMinutes} onChange={set('warmupDurationMinutes')} /></div>
      <div className={ROW}><span className={LABEL}>Test duration (min)</span>
        <Input className={NUM} value={value.testDurationMinutes} onChange={set('testDurationMinutes')} /></div>
      <div className={ROW}><span className={LABEL}>Key distributor</span>
        <select
          className="w-48 bg-slate-900 border border-slate-700 text-slate-100 rounded-md px-2 py-1 text-sm h-7 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          value={value.keyDistributor ?? ''}
          onChange={e => onChange({ ...value, keyDistributor: e.target.value || undefined })}
        >
          <option value="">— default (NO_KEY) —</option>
          {KEY_DISTRIBUTORS.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>

      <div className="flex items-center gap-4 mt-2 pt-2 border-t border-slate-800 text-xs flex-wrap">
        <span className="text-slate-500">Produce</span>
        <span className="text-emerald-400 font-mono">{rates.produceMsgPerSec.toLocaleString()} msg/s · {rates.produceMBPerSec.toFixed(1)} MB/s</span>
        <span className="text-slate-600">·</span>
        <span className="text-slate-500">Consume</span>
        <span className="text-emerald-400 font-mono">{rates.consumeMsgPerSec.toLocaleString()} msg/s · {rates.consumeMBPerSec.toFixed(1)} MB/s</span>
        <span className="text-slate-600">·</span>
        <span className="text-slate-500 font-mono">{rates.totalDurationMinutes} min total</span>
      </div>
    </div>
  )
}
