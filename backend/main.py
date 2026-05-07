from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from backend.database import init_db
from backend.services.omb_runner import OmbRunner
from backend.routers import config_router, runs_router, ws_router, prometheus_router

STATIC_DIR = Path(__file__).parent.parent / "frontend" / "dist"

runner_instance = OmbRunner()

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    runs_router.set_runner(runner_instance)
    yield

app = FastAPI(title="OMB UI", lifespan=lifespan)

app.include_router(config_router.router)
app.include_router(runs_router.router)
app.include_router(ws_router.router)
app.include_router(prometheus_router.router)

# Serve React SPA — must come after API routes
if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        return FileResponse(str(STATIC_DIR / "index.html"))
