# 药衡智护 · M12 本地演示版

本仓库为独立导出的核心源码，不含原仓库历史、鸿蒙、Android 工程、开发缓存、个人凭证和业务数据库。保留原移动端网页与医生端网页。当前实现截至 M12；M13–M15 增强算法、知识与完整比赛验收未宣称完成。

## 下载后运行（Windows 10/11 x64）

请从 GitHub **Releases** 下载 `Yaoheng-Windows-x64.zip`，不要将 GitHub 自动生成的 Source code.zip 当作运行包。

1. 完整解压到当前用户可写的目录，例如 `D:\Yaoheng`。不要直接在压缩包内运行。
2. 双击 `Start.cmd`，首次启动会初始化独立的本地合成数据库，请等待 READY。浏览器自动打开移动端和医生端。
3. 在原页面选择本地测试账号登录，或使用家属 `13800000001`／医生 `13800000002`，合成密码 `Trial-2026!`。
4. 保持启动窗口打开。按 Ctrl+C 停止本次启动的服务。重新启动保留 `data/` 内的数据。

无需安装 Node、Maven、Python、Java 或 MySQL；不连接系统已有数据库，不需要管理员安装服务。首次启动也不下载依赖。Windows 可能提示允许运行来自互联网的程序，请核对 Release 校验和及来源。

`Start.cmd` 默认离线：人工录药、提醒、记录、规则候选、原分析与双报告可用，本地语音资源已包含。DeepSeek 图片识别及文字理解需要网络；双击 `Start-DeepSeek.cmd` 并隐藏输入自己的 API Key。Key 不随包分发、不保存至配置，缺 Key 或余额时仍可手动录入。蓝牙范围是简化软件协议与回放。

各服务只监听本机回环地址，端口自动选择。默认浏览器入口不是固定的 5173/5174，以启动窗口为准。关闭后不要删除 `data/`，其中包含独立数据库与本机随机生成的数据库凭证；不要将运行后的整个文件夹直接再上传。

## 当前功能边界

- 图片识别／语音转写／文字抽取只产生候选，需要人工核对；文字记录首次确认生成候选，再次核对后保存。
- 保留原 R1 评分、R3 基础图谱、追问与模板报告；M12 增加候选来源、保守时间解释、历史上下文冻结和回放。
- M13 联合链与六因子排序增强、M14 知识及新双报告尚未实现。只使用合成数据，不作临床准确率声明。
- 本包是 Windows 本地演示版，不是鸿蒙 HAP／Android APK。比赛官网格式、容量与联网规定需独立核对。

## 开发者

核心目录：`apps/`（两端源码）、`packages/`（共享逻辑）、`services/`（Java／AI／ASR）、`database/`（迁移）、`scripts/`（启动与测试）。锁文件和测试保留。

开发环境启动：安装 Node/npm、Java 21+／Maven、Python／uv 和 MySQL 后执行 `npm ci`，`uv sync --frozen --project services/ai-service`；本地语音另按 `services/inference-service/requirements.lock.txt` 安装并运行 `python scripts/setup_ra_asr.py`。使用 `python scripts/run_ra_m12.py` 启动；缺语音资源可加 `--no-asr`。

便携构建入口 `python scripts/portable/build.py --out <新目录>` 面向准备好依赖、MySQL 分发文件与语音资源的 Windows 构建机。它只增加启动／导出层，不改业务代码与 UI。Release 包提供第三方许可与来源清单；项目未另行授予开源许可。
