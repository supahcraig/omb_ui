import json
import yaml
from pathlib import Path
from backend.config import settings

_APP_SETTINGS = Path(__file__).parent.parent.parent / "app_settings.json"

def read_app_settings() -> dict:
    if _APP_SETTINGS.exists():
        return json.loads(_APP_SETTINGS.read_text())
    return {}

def write_app_settings(data: dict) -> None:
    _APP_SETTINGS.write_text(json.dumps(data, indent=2))


def _parse_kv_block(block: str) -> dict:
    """Parse a multiline key=value block (e.g. Kafka client config)."""
    result = {}
    for line in (block or "").strip().splitlines():
        line = line.strip()
        if "=" in line:
            key, _, value = line.partition("=")
            result[key.strip()] = value.strip()
    return result


def _build_kv_block(kv: dict) -> str:
    if not kv:
        return ""
    return "\n".join(f"{k}={v}" for k, v in kv.items()) + "\n"


def parse_driver_yaml(content: str) -> dict:
    data = yaml.safe_load(content) or {}
    return {
        "driverClass": data.get("driverClass", ""),
        "replicationFactor": data.get("replicationFactor", 3),
        "reset": data.get("reset", True),
        "topicConfig": _parse_kv_block(data.get("topicConfig") or ""),
        "commonConfig": _parse_kv_block(data.get("commonConfig") or ""),
        "producerConfig": _parse_kv_block(data.get("producerConfig") or ""),
        "consumerConfig": _parse_kv_block(data.get("consumerConfig") or ""),
    }


def _literal_str(s: str) -> str:
    """Marker class so PyYAML uses literal block style (|) for this string."""
    return s

class _LiteralStr(str):
    pass

def _literal_representer(dumper: yaml.Dumper, data: str) -> yaml.ScalarNode:
    return dumper.represent_scalar("tag:yaml.org,2002:str", data, style="|")

yaml.add_representer(_LiteralStr, _literal_representer)

def build_driver_yaml(parsed: dict) -> str:
    data = {
        "driverClass": parsed.get("driverClass", ""),
        "replicationFactor": parsed.get("replicationFactor", 3),
        "reset": parsed.get("reset", True),
        "topicConfig": _LiteralStr(_build_kv_block(parsed.get("topicConfig", {}))),
        "commonConfig": _LiteralStr(_build_kv_block(parsed.get("commonConfig", {}))),
        "producerConfig": _LiteralStr(_build_kv_block(parsed.get("producerConfig", {}))),
        "consumerConfig": _LiteralStr(_build_kv_block(parsed.get("consumerConfig", {}))),
    }
    return yaml.dump(data, default_flow_style=False, allow_unicode=True, sort_keys=False)


def parse_workload_yaml(content: str) -> dict:
    data = yaml.safe_load(content) or {}
    # Return all present fields; omit keys with None values
    return {k: v for k, v in data.items() if v is not None}


def build_workload_yaml(parsed: dict) -> str:
    return yaml.dump(parsed, default_flow_style=False, allow_unicode=True, sort_keys=False)


def read_driver() -> dict:
    path = Path(settings.OMB_DIR) / "driver.yaml"
    return parse_driver_yaml(path.read_text()) if path.exists() else {}


def write_driver(parsed: dict) -> None:
    path = Path(settings.OMB_DIR) / "driver.yaml"
    path.write_text(build_driver_yaml(parsed))


def read_workload() -> dict:
    path = Path(settings.OMB_DIR) / "workload.yaml"
    return parse_workload_yaml(path.read_text()) if path.exists() else {}


def write_workload(parsed: dict) -> None:
    path = Path(settings.OMB_DIR) / "workload.yaml"
    path.write_text(build_workload_yaml(parsed))
