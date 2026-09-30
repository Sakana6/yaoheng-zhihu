# Java 后端本地运行说明

## 工具链与入口

- 实现：JDK HttpServer、Maven、JDBC/HikariCP；入口 `com.yaoheng.backend.BackendApplication`。
- pom 编译目标为 Java 21；本次干净编译验证环境为 JDK 25.0.2。不要用 JDK 17 编译。
- 工作目录默认为仓库根目录，需要 `java` 和 `mvn` 在 PATH 中。
- 本期使用本地 MySQL 与合成数据；数据库盘点/迁移尚在后续任务，不直接执行 PostgreSQL 方言的 `database/sql/001_core_schema.sql` 到 MySQL。

## 编译和启动

Windows PowerShell：

```powershell
npm run build:backend
npm run dev:backend
```

对应实际脚本为 `services/backend/build.ps1` 与 `services/backend/run-dev.ps1`。编译执行 Maven clean compile，不等于业务测试；Maven失败会让脚本返回非零退出码。

启动前在当前进程配置以下环境变量（只说明变量名，不把真实密码写入仓库）：

| 变量 | 本地设置 |
| --- | --- |
| DB_ENABLED | true |
| DB_HOST | 127.0.0.1 |
| DB_PORT | 3306 或本地实际端口 |
| DB_NAME | 已准备好的合成数据数据库名 |
| DB_USER | 有相应库权限的本地账号 |
| DB_PASSWORD | 通过当前终端/本地安全配置提供 |

Windows脚本先验证必填配置和TCP可连接，再运行 Maven。TCP成功不代表凭据/表结构正确，启动后必须检查：

```powershell
Invoke-RestMethod http://localhost:3000/api/health
```

关注 `database.ready` 和 `database.status`，不能只看顶层 `status: ok`。患者和登录相关接口在数据库不可用时返回503。当前运行时可能自动创建提醒辅助表，因此未完成盘点前，不用未知来源数据库做启动测试。

macOS/Linux已有Maven环境可使用：

```bash
npm run dev:backend:unix
```

该命令直接执行 `mvn -f services/backend/pom.xml compile exec:java`，不依赖不存在的 shell 脚本，也不提供Windows TCP预检。仍需先配置相同DB环境变量；本批未在macOS/Linux实跑。

服务在前台运行，Ctrl+C停止；默认端口3000。不要用包含密码的命令行参数启动Java。

## 启动脚本回归

```powershell
npm run test:backend-scripts
```

覆盖配置缺失、TCP拒绝/异常、Maven启动失败、编译失败及成功路径。网络和Maven只在测试子进程中替换，不连接数据库、不运行后端服务；真实干净编译由 `npm run build:backend` 单独验证。

## 本批边界

本批只修正构建、源文件入口和启动脚本，不改Java业务路由、数据库模型或Python算法。完整数据库启动与跨端业务smoke保留在T00-C；后续按冻结任务逐步接通。
