# MySQL 本地迁移与 B02/B03 验收

本轮已在本机 MySQL **9.6.0** 实跑。SQL 使用 MySQL 8 系列兼容写法，但尚未在独立 MySQL 8 实例复验。既有业务库未修改。不要使用旧 `database/sql` 的 PostgreSQL 文件部署。

## 运行方式

在项目根目录的 PowerShell 设置（密码沿用用户已提供的值，不写入仓库）：

```powershell
$env:SPRING_DATASOURCE_USERNAME = 'root'
$env:SPRING_DATASOURCE_PASSWORD = '<本机数据库密码>'
$env:DB_ENABLED = 'true'
$env:DB_HOST = '127.0.0.1'
$env:DB_PORT = '3306'
$env:DB_NAME = 'yaoheng_synthetic_r1'
npm run db:local
npm run dev:backend
```

另开两个项目根目录终端：

```powershell
npm run dev -w apps/mobile-app -- --host 127.0.0.1 --port 5173 --strictPort
npm run dev -w apps/doctor-web -- --host 127.0.0.1 --port 5174 --strictPort
```

浏览器访问 `http://127.0.0.1:5173/profile` 和 `http://127.0.0.1:5174/patients`。

| 合成账号 | 密码 | 授权 |
| --- | --- | --- |
| 13800000001 | Trial-2026! | 家属；患者1与合成患者丙 |
| 13800000003 | Trial-2026! | 家属；合成患者乙 |
| 13800000002 | Trial-2026! | 医生；查看患者1和生成报告 |

以上密码仅为仓库合成试用账号，**不是数据库密码**。会话默认8小时有效；只在浏览器内存保存token，刷新后需重新登录；服务器重启不影响未过期会话，登出会撤销当前会话。

真实模式已启用登录/患者选择/药历、提醒计划/实例、反馈/补录和风险待处理入口。录药需人工确认开始日期；计划使用北京时间并携带版本/幂等键；停用保留历史。B06/B07已接入Python规则快照和医生HTML报告，见 `docs/handoff/b06-b07-acceptance-2026-09-29.md`。要查看原演示页面，在启动前设置 `VITE_DATA_SOURCE=demo`；不得同时配置冲突的 `VITE_USE_MOCK`。

## 迁移机制

- `V001`：核心表、真实外键和索引。
- `V002`：合成数据，SQL日期时间已统一为UTC。
- `V003`：持久会话、医生关系、药历版本/历史/幂等/审计、提醒辅助表。
- `V004`：保留旧提醒行，解除旧全局提醒键，建立患者级唯一键；补齐既有药历初始修订。
- `V005`：提醒计划、计划药品关系、版本化实例和药品快照。
- `V006`：原文反馈、不可变修订、确认事实、分析任务、追问关联。
- `V007`：审计资源 ID 支持计划/实例/反馈等不透明字符串。
- **只运行 `scripts/local_database.py`，不要逐文件重复 source。** runner记录版本与SHA-256；重复执行会校验后跳过。DDL不具备跨语句回滚能力，若迁移中断，须根据报错和已执行DDL检查后修复；不可手动伪造成功版本。
- `V008`：分析冻结清单、尝试记录、运行/最新指针和HTML报告任务。
- `V009`：医生复核、患者级随访、随访一次性提醒和回复关联。复核只追加，不覆盖机器快照；随访完成复用反馈TX1。
- 应用启动检查V009，无运行时建表/建索引；运行账号不需要DDL权限。
- 工具只允许 `yaoheng_synthetic_*` 隔离库名，固定本机连接；MySQL客户端默认来自 `C:/Program Files/MySQL/MySQL Server 9.6/bin`，可用 `MYSQL_BIN` 覆盖。
- 本机未发现旧药衡业务库；旧表升级使用合成legacy fixture演练，不宣称已经迁移其他已有项目库。对于未知既有库，先备份并建立其准确迁移基线，不能把空库初始化当升级脚本。

## 可复现测试

```powershell
npm run build:backend
mvn -q -f services/backend/pom.xml dependency:build-classpath '-Dmdep.outputFile=target/classpath.txt'
npm run test:r1-integration
npm run test:contracts
npm run test:session
```

集成测试使用 `yaoheng_synthetic_r1_test` 和 `yaoheng_synthetic_r1_restore`；测试自启30007端口Java并在finally停止，演练备份恢复到单独库。不会删除或覆盖 `yaoheng_synthetic_r1` 的人工验收记录。测试库保留用于检查，不含真实个人数据。Python契约验证使用AI服务现有venv的PyYAML/jsonschema；可通过 `CONTRACT_PYTHON` 指定已装这些依赖的解释器。

验收顺序：家属新增未知药 → 刷新重登 → 修改版本 → 医生刷新核对 → 停用并勾选历史 → 换账号/患者确认隔离。断网提交应保留草稿且没有成功提示。结束后在各启动终端按 Ctrl+C。
