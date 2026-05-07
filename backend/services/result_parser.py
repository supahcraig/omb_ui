import json
import statistics


def parse_result_file(path: str) -> dict:
    with open(path) as f:
        data = json.load(f)

    return {
        "publish_rate_avg": statistics.mean(data["publishRate"]),
        "consume_rate_avg": statistics.mean(data["consumeRate"]),
        "backlog_avg": statistics.mean(data["backlog"]),
        "publish_latency_avg": data["aggregatedPublishLatencyAvg"],
        "publish_latency_p50": data["aggregatedPublishLatency50pct"],
        "publish_latency_p75": data["aggregatedPublishLatency75pct"],
        "publish_latency_p95": data["aggregatedPublishLatency95pct"],
        "publish_latency_p99": data["aggregatedPublishLatency99pct"],
        "publish_latency_p999": data["aggregatedPublishLatency999pct"],
        "publish_latency_p9999": data["aggregatedPublishLatency9999pct"],
        "publish_latency_max": data["aggregatedPublishLatencyMax"],
        "end_to_end_latency_avg": data["aggregatedEndToEndLatencyAvg"],
        "end_to_end_latency_p50": data["aggregatedEndToEndLatency50pct"],
        "end_to_end_latency_p75": data["aggregatedEndToEndLatency75pct"],
        "end_to_end_latency_p95": data["aggregatedEndToEndLatency95pct"],
        "end_to_end_latency_p99": data["aggregatedEndToEndLatency99pct"],
        "end_to_end_latency_p999": data["aggregatedEndToEndLatency999pct"],
        "end_to_end_latency_p9999": data["aggregatedEndToEndLatency9999pct"],
        "end_to_end_latency_max": data["aggregatedEndToEndLatencyMax"],
        "throughput_timeseries": {
            "publish_rate": data["publishRate"],
            "consume_rate": data["consumeRate"],
            "sample_rate_ms": data["sampleRateMillis"],
        },
    }
