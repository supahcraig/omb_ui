from datetime import datetime
from pydantic import BaseModel


# --- Config ---

class DriverConfig(BaseModel):
    driverClass: str = "io.openmessaging.benchmark.driver.redpanda.RedpandaBenchmarkDriver"
    replicationFactor: int = 3
    reset: bool = True
    topicConfig: dict[str, str] = {}
    commonConfig: dict[str, str] = {}
    producerConfig: dict[str, str] = {}
    consumerConfig: dict[str, str] = {}


class WorkloadConfig(BaseModel):
    topics: int = 1
    partitionsPerTopic: int = 10
    messageSize: int = 1024
    payloadFile: str = "payload/payload-1Kb.data"
    subscriptionsPerTopic: int = 1
    consumerPerSubscription: int = 1
    producersPerTopic: int = 10
    producerRate: int = 10000
    consumerBacklogSizeGB: int = 0
    testDurationMinutes: int = 20
    warmupDurationMinutes: int = 5
    keyDistributor: str | None = None


class ConfigPayload(BaseModel):
    driver: DriverConfig
    workload: WorkloadConfig
    prometheus_url: str = ""
    prometheus_username: str = ""
    prometheus_password: str = ""
    sasl_username: str = ""
    sasl_password: str = ""


# --- Runs ---

class RunCreate(BaseModel):
    name: str | None = None


class MetricsOut(BaseModel):
    publish_rate_avg: float | None
    publish_latency_avg: float | None
    publish_latency_p50: float | None
    publish_latency_p75: float | None
    publish_latency_p95: float | None
    publish_latency_p99: float | None
    publish_latency_p999: float | None
    publish_latency_p9999: float | None
    publish_latency_max: float | None
    end_to_end_latency_avg: float | None
    end_to_end_latency_p50: float | None
    end_to_end_latency_p75: float | None
    end_to_end_latency_p95: float | None
    end_to_end_latency_p99: float | None
    end_to_end_latency_p999: float | None
    end_to_end_latency_p9999: float | None
    end_to_end_latency_max: float | None
    consume_rate_avg: float | None
    backlog_avg: float | None
    throughput_timeseries: dict | None

    model_config = {"from_attributes": True}


class RunOut(BaseModel):
    id: int
    name: str | None
    status: str
    started_at: datetime
    completed_at: datetime | None
    driver_config: dict
    workload_config: dict
    sweep_id: int | None
    sweep_params: dict | None
    metrics: MetricsOut | None

    model_config = {"from_attributes": True}


class RunListItem(BaseModel):
    id: int
    name: str | None
    status: str
    started_at: datetime
    completed_at: datetime | None
    publish_rate_avg: float | None = None
    publish_latency_p99: float | None = None
    publish_latency_p999: float | None = None
    end_to_end_latency_p99: float | None = None
    sweep_id: int | None = None

    model_config = {"from_attributes": True}


class PrometheusSampleOut(BaseModel):
    t: int
    batch_size_bytes: float | None
    bytes_in_per_sec: float | None
    bytes_out_per_sec: float | None
    model_config = {"from_attributes": True}


# --- Sweeps ---

class SweepCreate(BaseModel):
    name: str
    parameter_axes: dict[str, list[str]]
    cooldown_seconds: int = 60
    workload_config: dict = {}
    driver_base_config: dict = {}


class SweepOut(BaseModel):
    id: int
    name: str
    status: str
    parameter_axes: dict[str, list[str]]
    cooldown_seconds: int
    started_at: datetime
    completed_at: datetime | None
    run_count: int
    completed_count: int
    failed_count: int
    est_seconds_remaining: int | None

    model_config = {"from_attributes": True}


class SweepDetail(SweepOut):
    runs: list[RunOut]
