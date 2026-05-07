from fastapi import APIRouter
from backend.schemas import ConfigPayload
from backend.services.yaml_io import read_driver, read_workload, write_driver, write_workload

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get("")
async def get_config() -> dict:
    return {"driver": read_driver(), "workload": read_workload()}


@router.put("")
async def put_config(payload: ConfigPayload) -> dict:
    write_driver(payload.driver.model_dump())
    write_workload(payload.workload.model_dump(exclude_none=True))
    return {"status": "ok"}
