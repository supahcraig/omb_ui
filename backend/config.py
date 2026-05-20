from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    OMB_DIR: str = "/opt/benchmark"
    BROKER_ADDR: str = ""
    PROMETHEUS_URL: str = "http://localhost:9644"
    PROMETHEUS_USERNAME: str = "prometheus"
    PROMETHEUS_PASSWORD: str = ""
    SASL_USERNAME: str = ""
    SASL_PASSWORD: str = ""
    ANTHROPIC_API_KEY: str = ""
    db_url: str = "sqlite+aiosqlite:///./omb_ui.db"

settings = Settings()
