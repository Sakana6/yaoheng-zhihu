# 医生端接手说明

## 1. 端定位

医生端是低频高价值的信息消费端，面向：

- 医生
- 药师
- 护士
- 社区 / 基层机构

核心职责：

- 快速查看患者近期异常
- 查看联合事件时间轴
- 查看五类风险结果
- 查看并导出医生版复查摘要

## 2. 冻结页面范围

MVP 必做页面：

1. 患者详情页
2. 医生版摘要页
3. 导出 PDF

## 3. 推荐页面路由

```text
/patients
/patients/:patientId
/patients/:patientId/summary
/patients/:patientId/report/:reportId
```

## 4. 页面依赖的固定接口

- 患者资料：`GET /patients/{patientId}/profile`
- 当前药历：`GET /patients/{patientId}/medications`
- 联合事件：`GET /patients/{patientId}/joint-events`
- 风险结果：`GET /patients/{patientId}/risk/latest`
- 生成报告：`POST /patients/{patientId}/reports/generate`
- 报告查询：`GET /patients/{patientId}/reports/{reportId}`
- 报告下载：`GET /patients/{patientId}/reports/{reportId}/download`

## 5. 页面必须体现的重点

- 不是总分，而是五类风险拆分
- 每个风险卡片都有成因与建议动作
- 联合事件要能展开看到证据
- 报告要体现“复查辅助”，不是诊断结论
