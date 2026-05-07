import asyncio
import glob
import os
from pathlib import Path
from backend.config import settings


class OmbRunner:
    """Manages a single OMB subprocess. Collects stdout in memory."""

    def __init__(self):
        # run_id -> {"process", "lines", "done", "returncode", "result_file"}
        self._active: dict[int, dict] = {}

    async def start(self, run_id: int) -> None:
        omb_dir = Path(settings.OMB_DIR)
        existing_jsons = set(glob.glob(str(omb_dir / "workload-*.json")))

        proc = await asyncio.create_subprocess_exec(
            str(omb_dir / "bin" / "benchmark"),
            "--drivers", "driver.yaml",
            "workload.yaml",
            cwd=str(omb_dir),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        state: dict = {
            "process": proc,
            "lines": [],
            "done": False,
            "returncode": None,
            "result_file": None,
        }
        self._active[run_id] = state
        asyncio.create_task(self._collect(run_id, proc, existing_jsons, state))

    async def _collect(
        self,
        run_id: int,
        proc: asyncio.subprocess.Process,
        existing_jsons: set,
        state: dict,
    ) -> None:
        assert proc.stdout is not None
        async for raw in proc.stdout:
            state["lines"].append(raw.decode().rstrip())

        await proc.wait()
        state["returncode"] = proc.returncode

        omb_dir = Path(settings.OMB_DIR)
        new_jsons = set(glob.glob(str(omb_dir / "workload-*.json"))) - existing_jsons
        if new_jsons:
            state["result_file"] = max(new_jsons, key=os.path.getmtime)

        state["done"] = True

    def get_lines(self, run_id: int) -> list[str]:
        state = self._active.get(run_id)
        return state["lines"] if state else []

    def is_done(self, run_id: int) -> bool:
        state = self._active.get(run_id)
        return state["done"] if state else True

    def get_result_file(self, run_id: int) -> str | None:
        state = self._active.get(run_id)
        return state.get("result_file") if state else None

    def get_returncode(self, run_id: int) -> int | None:
        state = self._active.get(run_id)
        return state.get("returncode") if state else None

    async def stop(self, run_id: int) -> None:
        state = self._active.get(run_id)
        if state and not state["done"]:
            state["process"].terminate()
            await asyncio.sleep(0.5)
            if state["process"].returncode is None:
                state["process"].kill()
