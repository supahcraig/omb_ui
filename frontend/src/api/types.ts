export interface DriverConfig {
  driverClass: string
  replicationFactor: number
  reset: boolean
  topicConfig: Record<string, string>
  commonConfig: Record<string, string>
  producerConfig: Record<string, string>
  consumerConfig: Record<string, string>
}

export interface WorkloadConfig {
  topics: number
  partitionsPerTopic: number
  messageSize: number
  payloadFile: string
  subscriptionsPerTopic: number
  consumerPerSubscription: number
  producersPerTopic: number
  producerRate: number
  consumerBacklogSizeGB: number
  testDurationMinutes: number
  warmupDurationMinutes: number
  keyDistributor?: string
}

export interface ConfigPayload {
  driver: DriverConfig
  workload: WorkloadConfig
}

export interface Metrics {
  publish_rate_avg: number | null
  publish_latency_avg: number | null
  publish_latency_p50: number | null
  publish_latency_p75: number | null
  publish_latency_p95: number | null
  publish_latency_p99: number | null
  publish_latency_p999: number | null
  publish_latency_p9999: number | null
  publish_latency_max: number | null
  end_to_end_latency_avg: number | null
  end_to_end_latency_p50: number | null
  end_to_end_latency_p75: number | null
  end_to_end_latency_p95: number | null
  end_to_end_latency_p99: number | null
  end_to_end_latency_p999: number | null
  end_to_end_latency_p9999: number | null
  end_to_end_latency_max: number | null
  consume_rate_avg: number | null
  backlog_avg: number | null
  throughput_timeseries: {
    publish_rate: number[]
    consume_rate: number[]
    sample_rate_ms: number
  } | null
}

export interface Run {
  id: number
  name: string | null
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  started_at: string
  completed_at: string | null
  driver_config: DriverConfig
  workload_config: WorkloadConfig
  sweep_id: number | null
  sweep_params: Record<string, string> | null
  metrics: Metrics | null
}

export interface RunListItem {
  id: number
  name: string | null
  status: string
  started_at: string
  completed_at: string | null
  publish_rate_avg: number | null
  publish_latency_p99: number | null
  publish_latency_p999: number | null
  end_to_end_latency_p99: number | null
  sweep_id: number | null
}

export interface PrometheusSample {
  t: number
  batch_size_bytes: number | null
  bytes_in_per_sec: number | null
  bytes_out_per_sec: number | null
}

export interface Sweep {
  id: number
  name: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  parameter_axes: Record<string, string[]>
  cooldown_seconds: number
  started_at: string
  completed_at: string | null
  run_count: number
  completed_count: number
  failed_count: number
  est_seconds_remaining: number | null
}

export interface SweepDetail extends Sweep {
  runs: Run[]
}

export interface SweepCreatePayload {
  name: string
  parameter_axes: Record<string, string[]>
  cooldown_seconds: number
  workload_config: Record<string, unknown>
  driver_base_config: Record<string, unknown>
}
