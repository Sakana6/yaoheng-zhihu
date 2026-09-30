# AI 服务启动说明

## 使用 `pip`

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
python scripts/run_service.py
```

默认端口是 `8000`，健康检查：

```bash
curl http://localhost:8000/health
```

## 配置千问

在 `services/ai-service/.env.local` 中写入：

```env
AI_LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
AI_LLM_MODEL=qwen-plus
DASHSCOPE_API_KEY=你的密钥
```

说明：

- `.env.local` 不会提交到 git
- 没配密钥时，AI 服务仍然能运行，只是 `parse-event` 和 `generate-report` 不走千问增强
- 配了密钥后，这两条链路会返回 `*_qwen_hybrid_v1`

## 运行测试

```bash
source .venv/bin/activate
python scripts/run_tests.py
```

## 回放 MVP 样例

```bash
source .venv/bin/activate
python scripts/run_mvp_case.py
```

## 使用 `uv`

```bash
uv sync
uv run python scripts/run_service.py
uv run python scripts/run_tests.py
uv run python scripts/run_mvp_case.py
```

## 常见排查

### `curl` 输出最后多一个 `%`

这不是接口报错，而是终端提示“响应末尾没有换行”。例如：

```bash
curl -s ... ; echo
```

或者直接格式化输出：

```bash
curl -s ... | python3 -m json.tool
```

### 只想快速看 AI 有没有正常工作

先跑：

```bash
python scripts/run_mvp_case.py
```

如果能看到：

- `JE001`
- `deintensificationScore: 82`
- `reviewPriority: CLINIC_REVIEW`

说明 MVP 主链路是通的。
