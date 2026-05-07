import asyncio
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from backend.services.omb_runner import OmbRunner
from backend.routers.runs_router import get_runner

router = APIRouter(tags=["websocket"])


@router.websocket("/ws/runs/{run_id}")
async def ws_run_output(websocket: WebSocket, run_id: int):
    runner: OmbRunner = get_runner()
    await websocket.accept()
    sent = 0
    try:
        while True:
            lines = runner.get_lines(run_id)
            for line in lines[sent:]:
                await websocket.send_text(line)
            sent = len(lines)

            if runner.is_done(run_id):
                await websocket.send_json({"type": "done"})
                break

            await asyncio.sleep(0.1)
    except WebSocketDisconnect:
        pass
    finally:
        await websocket.close()
