"""AI 接口路由层。

路由层应尽量保持轻量：

- 保持请求和响应契约稳定
- 将实现细节委托给编排层
- 不在 HTTP 层混入业务规则、时间窗逻辑或模型代码
"""

from fastapi import APIRouter

from app.pipeline import pipeline
from app.schemas import (
    DetectJointEventsRequest,
    DetectJointEventsResponse,
    GenerateReportRequest,
    GenerateReportResponse,
    ParseEventRequest,
    ParseEventResponse,
    ScoreRiskRequest,
    ScoreRiskResponse,
)


router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/parse-event", response_model=ParseEventResponse)
def parse_event(request: ParseEventRequest) -> ParseEventResponse:
    return pipeline.parse_event(request)


@router.post("/detect-joint-events", response_model=DetectJointEventsResponse)
def detect_joint_events(request: DetectJointEventsRequest) -> DetectJointEventsResponse:
    return pipeline.detect_joint_events(request)


@router.post("/score-risk", response_model=ScoreRiskResponse)
def score_risk(request: ScoreRiskRequest) -> ScoreRiskResponse:
    return pipeline.score_risk(request)


@router.post("/generate-report", response_model=GenerateReportResponse)
def generate_report(request: GenerateReportRequest) -> GenerateReportResponse:
    return pipeline.generate_report(request)
