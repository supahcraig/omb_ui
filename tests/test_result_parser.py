import pytest
from pathlib import Path
from backend.services.result_parser import parse_result_file

FIXTURE = Path(__file__).parent / "fixtures" / "sample_result.json"

def test_parse_publish_rate_avg():
    m = parse_result_file(str(FIXTURE))
    # mean of [10337.6, 10004.5, 10001.7, 9997.3, 10003.7, 9997.1] ≈ 10057.0
    assert 10000 < m["publish_rate_avg"] < 10400

def test_parse_publish_latency_percentiles():
    m = parse_result_file(str(FIXTURE))
    assert m["publish_latency_p50"] == 8.154
    assert m["publish_latency_p99"] == 14.33
    assert m["publish_latency_p9999"] == 21.701
    assert m["publish_latency_max"] == 36.669

def test_parse_end_to_end_latency():
    m = parse_result_file(str(FIXTURE))
    assert m["end_to_end_latency_p99"] == 15.268
    assert m["end_to_end_latency_p9999"] == 221.005

def test_throughput_timeseries_included():
    m = parse_result_file(str(FIXTURE))
    assert m["throughput_timeseries"]["publish_rate"] == pytest.approx(
        [10337.6, 10004.5, 10001.7, 9997.3, 10003.7, 9997.1], rel=1e-3
    )
    assert m["throughput_timeseries"]["sample_rate_ms"] == 10000

def test_backlog_avg():
    m = parse_result_file(str(FIXTURE))
    # mean of [0, 0, 21, 11, 32, 21] ≈ 14.17
    assert abs(m["backlog_avg"] - 14.17) < 0.1
