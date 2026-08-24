"""Bounded concurrency limiter for the heavy mesh/solve pipeline.

Appropriate for a single shared VM: rather than letting every connected
session's subprocess pipeline run at once and starve the machine's CPU/RAM,
at most MAX_CONCURRENT run together — anything past that genuinely queues
(waits its turn, with a real "position N" message on its own WS connection)
until a slot frees up.

This is an in-process queue (asyncio.Semaphore + a waiting counter), which is
the right scale for one VM. A Redis/RQ-style distributed queue only starts
earning its complexity across multiple app-server processes or machines,
which isn't this deployment target — see the project's own notes on why a
single Docker VM was chosen. If that ever changes, this is the seam to
replace: everything above it (routers/mesh.py, routers/mesh_independence.py)
only depends on the `slot()` async context manager, not on how it's
implemented.
"""
from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from typing import Awaitable, Callable, AsyncIterator

# One real mesh/solve pipeline is already CPU- and memory-heavy (a real
# subprocess doing real work) — 2 is a conservative default for a small VM,
# overridable per-deployment without a code change.
MAX_CONCURRENT_JOBS = max(1, int(os.environ.get("HX_MAX_CONCURRENT_JOBS", "2")))

Send = Callable[[dict], Awaitable[None]]


class JobQueue:
    def __init__(self, max_concurrent: int) -> None:
        self._sem = asyncio.Semaphore(max_concurrent)
        self._waiting = 0
        self._count_lock = asyncio.Lock()

    @asynccontextmanager
    async def slot(self, send: Send) -> AsyncIterator[None]:
        """Waits for a free execution slot, announcing queue position via
        `send` while waiting, then yields with the slot held until the
        caller's block exits (success or failure — always released). Takes a
        send callable rather than a raw WebSocket so callers that fan out
        multiple concurrent jobs onto one connection (see
        routers/mesh_independence.py) can pass a lock-guarded sender instead
        of risking two coroutines writing to the socket at once."""
        async with self._count_lock:
            self._waiting += 1
            position = self._waiting

        if position > 1 or self._sem.locked():
            await send({
                "stage": "queued",
                "percent": 0,
                "detail": f"Waiting for a free slot on this server – {position - 1} job(s) ahead…",
                "jobStatus": "running",
                "source": "openfoam",
            })

        await self._sem.acquire()
        async with self._count_lock:
            self._waiting -= 1
        try:
            yield
        finally:
            self._sem.release()

    @property
    def waiting(self) -> int:
        return self._waiting

    @property
    def running(self) -> int:
        # asyncio.Semaphore doesn't publish its remaining count, so this is
        # derived rather than read directly — see status() below, the only
        # place this is used.
        return MAX_CONCURRENT_JOBS - self._sem._value  # noqa: SLF001


# One shared instance for mesh AND solve — they're both real CPU/memory-heavy
# subprocess work, so a mesh job and a solve job compete for the SAME budget
# rather than each getting their own MAX_CONCURRENT_JOBS (which would let the
# machine run up to 2x that many heavy processes at once).
job_queue = JobQueue(MAX_CONCURRENT_JOBS)
mesh_queue = job_queue
solve_queue = job_queue


def status() -> dict:
    """Real, current queue state — see GET /queue-status."""
    return {"running": job_queue.running, "waiting": job_queue.waiting, "maxConcurrent": MAX_CONCURRENT_JOBS}
