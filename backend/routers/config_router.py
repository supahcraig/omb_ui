from fastapi import APIRouter
from backend.config import settings as env_settings
from backend.schemas import ConfigPayload
from backend.services.yaml_io import read_driver, read_workload, write_driver, write_workload, read_app_settings, write_app_settings

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get("")
async def get_config() -> dict:
    saved = read_app_settings()
    return {
        "driver": read_driver(),
        "workload": read_workload(),
        "prometheus_url": saved.get("prometheus_url") or env_settings.PROMETHEUS_URL,
        "prometheus_username": saved.get("prometheus_username", ""),
        "prometheus_password": saved.get("prometheus_password", ""),
    }


@router.put("")
async def put_config(payload: ConfigPayload) -> dict:
    write_driver(payload.driver.model_dump())
    write_workload(payload.workload.model_dump(exclude_none=True))
    current = read_app_settings()
    write_app_settings({
        **current,
        "prometheus_url": payload.prometheus_url or current.get("prometheus_url", ""),
        "prometheus_username": payload.prometheus_username,
        "prometheus_password": payload.prometheus_password,
    })
    return {"status": "ok"}
