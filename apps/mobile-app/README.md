# Mobile App

当前移动端已经升级为 `Vue 3 + Vite + Capacitor Android`，核心场景是：

- 关键时间窗口服药提醒
- 原生 TTS 播报“现在请吃 XXX 药”
- 语音识别老人回答
- 将服药结果和追问回答写回后端数据库

## 目录

- Web 前端：`apps/mobile-app/src`
- Android 原生工程：`apps/mobile-app/android`
- Capacitor 配置：`apps/mobile-app/capacitor.config.ts`

## 本地开发

在仓库根目录执行：

```powershell
npm install
npm run dev:mobile
```

默认会使用 `VITE_USE_MOCK=true`。如果要连真实后端：

```powershell
$env:VITE_USE_MOCK='false'
$env:VITE_API_BASE_URL='http://<your-backend-host>:3000/api'
npm run dev:mobile
```

注意：

- Android 真机或模拟器不能用 `localhost` 访问你电脑上的后端。
- 请把 `VITE_API_BASE_URL` 改成局域网 IP，或模拟器可访问的地址。

## Android 构建

先生成并同步 Web 资源到 Android 工程：

```powershell
npm run build:android -w apps/mobile-app
```

打开 Android 工程：

```powershell
npm run cap:open:android -w apps/mobile-app
```

## 环境要求

- Node.js 18+
- JDK 17 或 JDK 21
- Android SDK

当前仓库里已经验证：

- `vue-tsc` 和 `vite build` 通过
- `npx cap sync android` 通过

如果本机默认是 Java 25，Gradle 可能失败。可临时切回 JDK 17：

```powershell
$env:JAVA_HOME='D:\Java\jdk-17'
$env:Path="D:\Java\jdk-17\bin;$env:Path"
```

如果提示 `SDK location not found`，需要配置 Android SDK：

```powershell
$env:ANDROID_HOME='C:\Users\<you>\AppData\Local\Android\Sdk'
```

或者在 `apps/mobile-app/android/local.properties` 中写入：

```properties
sdk.dir=C:\\Users\\<you>\\AppData\\Local\\Android\\Sdk
```

## 当前能力

- 首页是“语音提醒驾驶舱”
- 后端会根据有效药历自动生成当天服药提醒
- 提醒接口会返回药物列表、播报文本、追问文本
- App 可调用：
  - 本地通知
  - 文本转语音
  - 语音识别
  - 服药依从性记录
  - 追问答案入库

## 主要接口

- `GET /patients/{patientId}/reminders/today`
- `POST /patients/{patientId}/reminders/ack`
- `POST /patients/{patientId}/adherence-events`
- `POST /patients/{patientId}/inquiry-sessions/start`
- `GET /patients/{patientId}/inquiry-sessions/{sessionId}/next-question`
- `POST /patients/{patientId}/inquiry-sessions/{sessionId}/answer`
