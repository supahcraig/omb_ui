import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { WorkloadConfig } from '@/api/types'
import { calculateRates } from './rateCalculator'

interface Props {
  value: WorkloadConfig
  onChange: (updated: WorkloadConfig) => void
}

function Field({ label, value, onChange, type = 'text' }: {
  label: string; name: string; value: string | number
  onChange: (val: string) => void; type?: string
}) {
  return (
    <div>
      <Label className="text-xs text-slate-400 uppercase tracking-wide">{label}</Label>
      <Input className="mt-1 bg-slate-900 border-slate-700 text-slate-100"
        type={type} value={value}
        onChange={e => onChange(e.target.value)} />
    </div>
  )
}

export default function WorkloadForm({ value, onChange }: Props) {
  const set = (key: keyof WorkloadConfig) => (val: string) => {
    const numeric = ['topics','partitionsPerTopic','messageSize','subscriptionsPerTopic',
      'consumerPerSubscription','producersPerTopic','producerRate','consumerBacklogSizeGB',
      'testDurationMinutes','warmupDurationMinutes']
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
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Topics" name="topics" value={value.topics} onChange={set('topics')} type="number" />
        <Field label="Partitions/Topic" name="partitionsPerTopic" value={value.partitionsPerTopic} onChange={set('partitionsPerTopic')} type="number" />
        <Field label="Message Size (bytes)" name="messageSize" value={value.messageSize} onChange={set('messageSize')} type="number" />
        <Field label="Producer Rate (msg/s)" name="producerRate" value={value.producerRate} onChange={set('producerRate')} type="number" />
        <Field label="Producers/Topic" name="producersPerTopic" value={value.producersPerTopic} onChange={set('producersPerTopic')} type="number" />
        <Field label="Subscriptions/Topic" name="subscriptionsPerTopic" value={value.subscriptionsPerTopic} onChange={set('subscriptionsPerTopic')} type="number" />
        <Field label="Consumers/Subscription" name="consumerPerSubscription" value={value.consumerPerSubscription} onChange={set('consumerPerSubscription')} type="number" />
        <Field label="Consumer Backlog (GB)" name="consumerBacklogSizeGB" value={value.consumerBacklogSizeGB} onChange={set('consumerBacklogSizeGB')} type="number" />
        <Field label="Warmup (min)" name="warmupDurationMinutes" value={value.warmupDurationMinutes} onChange={set('warmupDurationMinutes')} type="number" />
        <Field label="Test Duration (min)" name="testDurationMinutes" value={value.testDurationMinutes} onChange={set('testDurationMinutes')} type="number" />
        <Field label="Payload File" name="payloadFile" value={value.payloadFile} onChange={set('payloadFile')} />
        <Field label="Key Distributor (optional)" name="keyDistributor" value={value.keyDistributor ?? ''} onChange={set('keyDistributor')} />
      </div>

      {/* Rate calculator summary */}
      <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 text-sm space-y-1">
        <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">Expected Rates</div>
        <div className="grid grid-cols-2 gap-2 text-slate-300">
          <span>Produce:</span>
          <span className="text-emerald-400 font-mono">
            {rates.produceMsgPerSec.toLocaleString()} msg/s · {rates.produceMBPerSec.toFixed(1)} MB/s
          </span>
          <span>Consume:</span>
          <span className="text-emerald-400 font-mono">
            {rates.consumeMsgPerSec.toLocaleString()} msg/s · {rates.consumeMBPerSec.toFixed(1)} MB/s
          </span>
          <span>Duration:</span>
          <span className="text-slate-400 font-mono">{rates.totalDurationMinutes} min total</span>
        </div>
      </div>
    </div>
  )
}
