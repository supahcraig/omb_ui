import os
import pytest
from backend.config import Settings

def test_settings_defaults():
    s = Settings(OMB_DIR="/opt/benchmark", PROMETHEUS_URL="http://localhost:9644", ANTHROPIC_API_KEY="test")
    assert s.OMB_DIR == "/opt/benchmark"
    assert s.db_url == "sqlite+aiosqlite:///./omb_ui.db"
