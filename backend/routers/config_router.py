from fastapi import APIRouter
from backend.config import settings as env_settings
from backend.schemas import ConfigPayload
from backend.services.yaml_io import read_driver, read_workload, write_driver, write_workload, read_app_settings, write_app_settings

router = APIRouter(prefix="/api/config", tags=["config"])


def _build_jaas_config(mechanism: str, username: str, password: str) -> str:
    if 'SCRAM' in mechanism.upper():
        module = 'org.apache.kafka.common.security.scram.ScramLoginModule'
    else:
        module = 'org.apache.kafka.common.security.plain.PlainLoginModule'
    return f'{module} required username="{username}" password="{password}";'


@router.get("")
async def get_config() -> dict:
    saved = read_app_settings()
    driver = read_driver()

    # Inject BROKER_ADDR env default if bootstrap.servers not already set in driver.yaml
    if env_settings.BROKER_ADDR and not driver.get('commonConfig', {}).get('bootstrap.servers'):
        driver.setdefault('commonConfig', {})['bootstrap.servers'] = env_settings.BROKER_ADDR

    return {
        "driver": driver,
        "workload": read_workload(),
        "prometheus_url": saved.get("prometheus_url") or env_settings.PROMETHEUS_URL,
        "prometheus_username": saved.get("prometheus_username") or env_settings.PROMETHEUS_USERNAME,
        "prometheus_password": saved.get("prometheus_password") or env_settings.PROMETHEUS_PASSWORD,
        "sasl_username": saved.get("sasl_username") or env_settings.SASL_USERNAME,
        "sasl_password": saved.get("sasl_password") or env_settings.SASL_PASSWORD,
    }


@router.put("")
async def put_config(payload: ConfigPayload) -> dict:
    driver = payload.driver.model_dump()

    # Construct jaas.config from sasl credentials if provided
    if payload.sasl_username and payload.sasl_password:
        mechanism = driver.get('commonConfig', {}).get('sasl.mechanism', 'SCRAM-SHA-256')
        driver.setdefault('commonConfig', {})['sasl.jaas.config'] = _build_jaas_config(
            mechanism, payload.sasl_username, payload.sasl_password
        )

    write_driver(driver)
    write_workload(payload.workload.model_dump(exclude_none=True))

    current = read_app_settings()
    write_app_settings({
        **current,
        "prometheus_url": payload.prometheus_url or current.get("prometheus_url", ""),
        "prometheus_username": payload.prometheus_username,
        "prometheus_password": payload.prometheus_password,
        "sasl_username": payload.sasl_username,
        "sasl_password": payload.sasl_password,
    })
    return {"status": "ok"}
