import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch
from backend.main import app

@pytest.mark.asyncio
async def test_get_config_returns_driver_and_workload():
    mock_driver = {
        "driverClass": "io.openmessaging.benchmark.driver.redpanda.RedpandaBenchmarkDriver",
        "replicationFactor": 3, "reset": True,
        "topicConfig": {}, "commonConfig": {"bootstrap.servers": "localhost:9092"},
        "producerConfig": {"acks": "all", "linger.ms": "1"},
        "consumerConfig": {"group.id": "bench"},
    }
    mock_workload = {"topics": 1, "partitionsPerTopic": 10, "messageSize": 1024,
                     "payloadFile": "payload/p.data", "subscriptionsPerTopic": 1,
                     "consumerPerSubscription": 1, "producersPerTopic": 10,
                     "producerRate": 10000, "consumerBacklogSizeGB": 0,
                     "testDurationMinutes": 20, "warmupDurationMinutes": 5}
    with patch("backend.routers.config_router.read_driver", return_value=mock_driver), \
         patch("backend.routers.config_router.read_workload", return_value=mock_workload):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.get("/api/config")
    assert resp.status_code == 200
    body = resp.json()
    assert body["driver"]["commonConfig"]["bootstrap.servers"] == "localhost:9092"
    assert body["workload"]["producerRate"] == 10000
