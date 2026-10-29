"""헬스 체크(인증 없음). 버전·설정·키 정보는 내보내지 않는다."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.errors import ok

router = APIRouter()


@router.get("/health")
async def health() -> JSONResponse:
    return ok({"status": "ok"})
