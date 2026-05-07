from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    OMB_DIR: str = "/opt/benchmark"
    PROMETHEUS_URL: str = "http://localhost:9644"
    ANTHROPIC_API_KEY: str = ""
    db_url: str = "sqlite+aiosqlite:///./omb_ui.db"

    class Config:
        env_file = ".env"

settings = Settings()
