# AI 服务接手说明

> 当前生产接线：R1 `/ai/r1/analyze` 负责原评分；R3 `/ai/r3/project`、`/ai/r3/graph`负责派生解释；M10受控报告在Java本地模板生成。下方四接口说明为早期管线背景，不是第二生产入口。交付与限制见[本地手册](../../docs/handoff/r3-local-delivery-guide.md)。

## 1. 服务定位

AI 服务负责：

- 文本结构化理解
- 联合事件识别
- 五类风险评分
- 双视图报告生成

## 2. 固定接口

- `POST /ai/parse-event`
- `POST /ai/detect-joint-events`
- `POST /ai/score-risk`
- `POST /ai/generate-report`

推荐调用顺序：

1. `parse-event`：把自然语言描述转成结构化字段
2. `detect-joint-events`：把事件流识别成 `JE001` 等联合事件
3. `score-risk`：把联合事件转换成四类风险分数和一个复查优先级
4. `generate-report`：把风险结果转成家属版 / 医生版摘要

正式契约见：

- [../../packages/contracts/ai/ai-io-spec.yaml](../../packages/contracts/ai/ai-io-spec.yaml)

## 3. 当前实现状态

当前 AI 服务已经不是空 stub，而是可运行的 MVP：

- `parse-event`：规则解析为主，可选千问增强
- `detect-joint-events`：规则引擎，首轮稳定支持 `JE001`-`JE005`
- `score-risk`：规则评分 + 画像修正
- `generate-report`：模板生成，可选千问润色

大模型当前只接在两层：

- `parse-event`
- `generate-report`

联合事件识别和风险评分仍然保持本地可解释规则，不交给大模型自由决策。

## 4. AI 必须遵守的边界

- LLM 只负责结构化理解、追问语言优化、解释增强
- 不直接输出最终医疗结论
- 输出必须通过 JSON Schema 校验
- 校验失败要有 fallback
- 不得私自修改输出字段名

## 5. 最常见的使用方式

### 5.1 文本结构化

```bash
curl -s -X POST http://localhost:8000/ai/parse-event \
  -H 'Content-Type: application/json' \
  -d '{
    "patientId": 1,
    "triggerType": "symptom",
    "rawText": "今天早上头晕，早餐没吃完，药后来补吃了",
    "context": {
      "currentMedications": ["二甲双胍", "缬沙坦"],
      "latestBg": 3.8
    }
  }' | python3 -m json.tool
```

返回值含义：

- `structuredEvent.symptoms`：抽取到的症状编码
- `structuredEvent.meal`：进食状态
- `structuredEvent.adherence`：漏服 / 补服信息
- `structuredEvent.timeHint`：时间线索
- `confidence`：文本结构化置信度
- `modelVersion`：当前使用的是规则链还是千问增强链

### 5.2 MVP 全链路回放

```bash
python scripts/run_mvp_case.py
```

这个脚本会直接读取 [../../packages/contracts/examples/mvp-demo-case.json](../../packages/contracts/examples/mvp-demo-case.json)，顺序执行：

- `detect-joint-events`
- `score-risk`
- `generate-report`

### 5.3 测试

```bash
python scripts/run_tests.py
```

当前测试覆盖：

- 模块单测
- HTTP 接口测试
- 契约测试
- MVP golden case
- 大模型增强层回退测试

## 6. 首批必须支持的联合事件模板

- `JE001` 到 `JE010`

建议第一批先以 `JE001` 跑通全链路，再逐步补齐剩余模板。

## 7. 推荐交付顺序

1. `parse-event`
2. `detect-joint-events`
3. `score-risk`
4. `generate-report`

## 8. 当前阶段不建议

- 直接把自由文本返回给前端
- 先做黑盒大模型评分
- 把联用风险直接等同于过强化治疗
- 为了方便演示临时修改输出结构
