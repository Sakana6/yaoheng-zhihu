from fastapi import FastAPI

from app.routes import ai, health
from app.r1 import router as r1_router
from app.r3_projection import router as r3_router
from app.r3_graph import router as r3_graph_router
from app.ra_capture import router as ra_capture_router


app = FastAPI(
    title="药衡智护 AI Service",
    version="0.1.0",
    description=(
        "AI 服务基础骨架。当前保留固定 4 个接口，并在模块层明确知识底座、结构化理解、"
        "时间窗对齐、联合事件识别、画像修正、风险评分、双视图报告的后续实现位置。"
    ),
)

app.include_router(health.router)
app.include_router(ai.router)
app.include_router(r1_router)
app.include_router(r3_router)
app.include_router(r3_graph_router)
app.include_router(ra_capture_router)

from app.ra_candidates import router as ra_candidates_router
app.include_router(ra_candidates_router)

from app.ra_projection import router as ra_projection_router
app.include_router(ra_projection_router)
