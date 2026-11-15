import secrets

import uvicorn
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from . import worker
from .config import settings
from .schemas import ExecuteRequest, ExecuteResponse


def verify_api_key(x_api_key: str | None = Header(default=None, alias="X-API-Key")) -> None:
    if not x_api_key or not secrets.compare_digest(x_api_key, settings.AEGIS_API_KEY):
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key")


app = FastAPI(title="Aegis-Run Sandbox API", version="2.4.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


@app.get("/api/v1/health", dependencies=[Depends(verify_api_key)])
async def health() -> dict[str, object]:
    return {
        "status": "ok",
        "version": "2.4.0",
        "engine_ready": worker.engine_ready(),
        "mode": worker.current_mode(),
        "max_concurrent": settings.MAX_CONCURRENT_SANDBOXES,
    }


@app.post("/api/v1/execute", response_model=ExecuteResponse, dependencies=[Depends(verify_api_key)])
async def execute(request: ExecuteRequest) -> ExecuteResponse:
    try:
        return await worker.run_job(request)
    except worker.JobInputError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except worker.EngineError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


if __name__ == "__main__":
    uvicorn.run("api.main:app", host=settings.API_HOST, port=settings.API_PORT)
