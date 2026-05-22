from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase
from backend.config import settings

engine = create_async_engine(settings.db_url, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)

class Base(DeclarativeBase):
    pass

async def get_db() -> AsyncSession:
    async with SessionLocal() as session:
        yield session

_MIGRATIONS = [
    ("metrics",            "backlog_timeseries", "JSON"),
    ("prometheus_samples", "records_per_sec",    "REAL"),
]

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        for table, column, col_type in _MIGRATIONS:
            rows = await conn.execute(text(f"PRAGMA table_info({table})"))
            existing = {r[1] for r in rows}
            if column not in existing:
                await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}"))
