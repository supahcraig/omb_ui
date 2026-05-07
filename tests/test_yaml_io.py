import pytest
from pathlib import Path
from backend.services.yaml_io import parse_driver_yaml, parse_workload_yaml, build_driver_yaml, build_workload_yaml

FIXTURES = Path(__file__).parent / "fixtures"

def test_parse_driver_extracts_top_level():
    content = (FIXTURES / "driver.yaml").read_text()
    parsed = parse_driver_yaml(content)
    assert parsed["driverClass"] == "io.openmessaging.benchmark.driver.redpanda.RedpandaBenchmarkDriver"
    assert parsed["replicationFactor"] == 3
    assert parsed["reset"] is True

def test_parse_driver_extracts_common_config():
    content = (FIXTURES / "driver.yaml").read_text()
    parsed = parse_driver_yaml(content)
    assert parsed["commonConfig"]["bootstrap.servers"] == "broker:9092"
    assert parsed["commonConfig"]["security.protocol"] == "SASL_SSL"
    # Value with = in it must not be split
    assert "ScramLoginModule" in parsed["commonConfig"]["sasl.jaas.config"]

def test_parse_driver_extracts_producer_config():
    content = (FIXTURES / "driver.yaml").read_text()
    parsed = parse_driver_yaml(content)
    assert parsed["producerConfig"]["acks"] == "all"
    assert parsed["producerConfig"]["linger.ms"] == "1"

def test_roundtrip_driver():
    content = (FIXTURES / "driver.yaml").read_text()
    parsed = parse_driver_yaml(content)
    rebuilt = build_driver_yaml(parsed)
    re_parsed = parse_driver_yaml(rebuilt)
    assert re_parsed["commonConfig"]["bootstrap.servers"] == parsed["commonConfig"]["bootstrap.servers"]
    assert re_parsed["producerConfig"]["linger.ms"] == parsed["producerConfig"]["linger.ms"]

def test_parse_workload():
    content = (FIXTURES / "workload.yaml").read_text()
    parsed = parse_workload_yaml(content)
    assert parsed["topics"] == 1
    assert parsed["producerRate"] == 10000
    assert parsed["messageSize"] == 1024
    assert parsed["testDurationMinutes"] == 20

def test_roundtrip_workload():
    content = (FIXTURES / "workload.yaml").read_text()
    parsed = parse_workload_yaml(content)
    rebuilt = build_workload_yaml(parsed)
    re_parsed = parse_workload_yaml(rebuilt)
    assert re_parsed["producerRate"] == parsed["producerRate"]
    assert re_parsed.get("keyDistributor") == parsed.get("keyDistributor")
