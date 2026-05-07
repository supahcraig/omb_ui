from datetime import datetime
from sqlalchemy import Integer, String, Float, DateTime, ForeignKey, JSON, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.database import Base

class Run(Base):
    __tablename__ = "runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(String, default="pending")  # pending|running|completed|failed|cancelled
    started_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    driver_config: Mapped[dict] = mapped_column(JSON)
    workload_config: Mapped[dict] = mapped_column(JSON)
    sweep_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sweep_params: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    metrics: Mapped["Metrics | None"] = relationship("Metrics", back_populates="run", uselist=False, cascade="all, delete-orphan")

class Metrics(Base):
    __tablename__ = "metrics"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(Integer, ForeignKey("runs.id"), unique=True)
    publish_rate_avg: Mapped[float | None] = mapped_column(Float, nullable=True)
    publish_latency_avg: Mapped[float | None] = mapped_column(Float, nullable=True)
    publish_latency_p50: Mapped[float | None] = mapped_column(Float, nullable=True)
    publish_latency_p75: Mapped[float | None] = mapped_column(Float, nullable=True)
    publish_latency_p95: Mapped[float | None] = mapped_column(Float, nullable=True)
    publish_latency_p99: Mapped[float | None] = mapped_column(Float, nullable=True)
    publish_latency_p999: Mapped[float | None] = mapped_column(Float, nullable=True)
    publish_latency_p9999: Mapped[float | None] = mapped_column(Float, nullable=True)
    publish_latency_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_to_end_latency_avg: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_to_end_latency_p50: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_to_end_latency_p75: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_to_end_latency_p95: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_to_end_latency_p99: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_to_end_latency_p999: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_to_end_latency_p9999: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_to_end_latency_max: Mapped[float | None] = mapped_column(Float, nullable=True)
    consume_rate_avg: Mapped[float | None] = mapped_column(Float, nullable=True)
    backlog_avg: Mapped[float | None] = mapped_column(Float, nullable=True)
    throughput_timeseries: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    run: Mapped["Run"] = relationship("Run", back_populates="metrics")

class PrometheusSample(Base):
    __tablename__ = "prometheus_samples"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(Integer, ForeignKey("runs.id", ondelete="CASCADE"), index=True)
    t: Mapped[int] = mapped_column(Integer)
    batch_size_bytes: Mapped[float | None] = mapped_column(Float, nullable=True)
    bytes_in_per_sec: Mapped[float | None] = mapped_column(Float, nullable=True)
    bytes_out_per_sec: Mapped[float | None] = mapped_column(Float, nullable=True)

class Sweep(Base):
    __tablename__ = "sweeps"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String, default="running")
    parameter_axes: Mapped[dict] = mapped_column(JSON)
    cooldown_seconds: Mapped[int] = mapped_column(Integer, default=60)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    runs: Mapped[list["Run"]] = relationship(
        "Run",
        foreign_keys="[Run.sweep_id]",
        primaryjoin="Run.sweep_id == Sweep.id",
    )

    @property
    def run_count(self) -> int:
        return len(self.runs)

    @property
    def completed_count(self) -> int:
        return sum(1 for r in self.runs if r.status == "completed")

    @property
    def failed_count(self) -> int:
        return sum(1 for r in self.runs if r.status in ("failed", "cancelled"))

    @property
    def est_seconds_remaining(self) -> int | None:
        if self.status != "running":
            return None
        pending = [r for r in self.runs if r.status == "pending"]
        if not pending:
            return None
        wc = pending[0].workload_config or {}
        run_minutes = wc.get("testDurationMinutes", 20) + wc.get("warmupDurationMinutes", 5)
        return len(pending) * (run_minutes * 60 + self.cooldown_seconds)
