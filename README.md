<h1 align="center">👁️ stalk · 视奸</h1>

<p align="center">把电脑、手机、平板的当前状态，实时汇总到一个网页里</p>

<p align="center">
  🖥️ 电脑活动 · 📱 手机 / Pad 应用 · 🎵 音乐播放 · 📍 位置轨迹 · 🌤️ 天气空气 · 💬 聊天与 AI
</p>

<p align="center">
  <strong>谁在用什么、听了什么、待在哪，打开页面就能看到 —— 像看直播一样看当下</strong>
</p>

<p align="center">
  <img alt="Node" src="https://img.shields.io/badge/Node.js-20+-339933?style=for-the-badge&logo=node.js&logoColor=white">
  <img alt="Vue" src="https://img.shields.io/badge/Vue-3-42b883?style=for-the-badge&logo=vue.js&logoColor=white">
  <img alt="Socket.IO" src="https://img.shields.io/badge/Socket.IO-4-010101?style=for-the-badge&logo=socket.io&logoColor=white">
  <img alt="Docker" src="https://img.shields.io/badge/Docker-部署-2496ED?style=for-the-badge&logo=docker&logoColor=white">
  <img alt="License" src="https://img.shields.io/badge/许可证-个人自用-yellow?style=for-the-badge">
</p>

<p align="center">
  🌐 线上示例：<a href="https://stalk.minecraftglz.top">stalk.minecraftglz.top</a>
</p>

---

## 🎯 这个项目能做什么

| 场景 | 具体能力 | 页面上看到的样子 |
|---|---|---|
| 🖥️ **电脑在干嘛** | 读取 Windows 当前前台窗口、进程名、浏览器标签页标题、CPU / 内存 | 「Edge 冲浪 - 某个网页标题」 |
| 📱 **手机在干嘛** | AutoTask 定时上报前台应用、电量、充电、锁屏状态 | 「小红书 - 某个笔记标题」 |
| 🎧 **在听什么** | 独立接口上报音乐播放数据 | 正在播放的歌曲与来源 |
| 📍 **人在哪** | GPS / 位置轨迹上报，配合 IP 归属地 | 位置 + 当地天气与 AQI |
| 🕵️ **实时监听流** | 所有设备的活动按时间自上而下滚动，新纪录渐入 | 无需刷新、无需翻页 |
| 📊 **今天用了多久** | 今日总结、Top Apps、24 小时柱状图、累计曲线、活跃热力墙 | 一眼看出时间花在哪 |
| 💬 **在线互动** | 实时在线人数、聊天室、AI 博客助手 | 右下角客服式浮窗 |
| 🤖 **AI 总结** | 规则型洞察：久坐提醒、熬夜提醒、电量提醒、天气建议 | 就近嵌入对应板块，不单独占一块 |

> ⚠️ **隐私提醒**：本项目只适合监控**你拥有**的设备，或**明确知情同意**的设备。把它用在别人身上之前，先取得对方同意。

---

## 📑 目录

- [🎯 这个项目能做什么](#-这个项目能做什么)
- [🔍 项目概述](#-项目概述)
- [✨ 核心功能](#-核心功能)
- [🛠️ 技术栈](#️-技术栈)
- [📁 项目结构](#-项目结构)
- [🚀 快速开始](#-快速开始)
- [🔌 接入设备](#-接入设备)
- [⚙️ 环境变量](#️-环境变量)
- [🌐 API 接口](#-api-接口)
- [🤖 AI 助手](#-ai-助手)
- [🔐 安全机制](#-安全机制)
- [🎨 主题与多语言](#-主题与多语言)
- [📦 部署](#-部署)
- [🩺 常见问题](#-常见问题)
- [📝 许可与备案](#-许可与备案)

---

## 🔍 项目概述

**stalk** 是一个自托管的「多端实时活动监控」面板。它不依赖数据库，不上传第三方云，所有数据都以 JSON 形式落在自己的服务器上。

它由三部分组成：

1. **服务端**（Node.js + Express + Socket.IO）：接收上报、维护状态、把变化实时推给所有打开的页面。
2. **前端面板**（原生 HTML/CSS/JS + Vue 3 CDN）：入口落地页 + 监控面板，桌面 / 平板 / 手机三套布局。
3. **上报端**：Windows PowerShell 脚本（可打包成无窗口 EXE）、Android / HarmonyOS 的 AutoTask + shell 脚本、或任何能发 HTTP 请求的东西。

### 它是怎么转起来的

```
 Windows Agent ─┐
 Android/Pad ───┼─→ POST /api/heartbeat（X-Auth-Key）─→ 服务端解析 / 映射 / 存储
 音乐 · 位置 ───┘                                            │
                                                             ├─→ Socket.IO 推送（实时）
 浏览器页面 ←──────── 轮询兜底（5s / 10s）←──────────────────┘
```

- **实时优先**：设备状态用 Socket 推送，同时每 5 秒轮询 `/api/devices` 兜底。
- **在线人数准**：用 `io.of('/').sockets.size` 统计真实连接数，而不是累计访问量。
- **重启不丢**：活动流、设备、聊天记录持久化到 `server/data/*.json`。

---

## ✨ 核心功能

### 🕵️ 实时监听流（首页核心）
- 新记录从上方渐入，旧记录顺移让位，动画使用 Vue `transition-group`。
- 展示格式统一为「时间 + 应用 - 内容」，例：`21:04  Trae - stalk/server.js`。
- 电脑端限制为视口高度内滚动，不会把整页越撑越长；手机端只展示最近 6 条。
- 桌面停留超过 10 分钟自动判定为「挂机」，不再直接算离线。

### 🖥️ 设备状态
| 类型 | 展示内容 |
|---|---|
| 电脑 | 在线状态、CPU、内存、当前路径、电量（笔记本） |
| 手机 / Pad | 电量与充电、温度、屏幕状态（含「熄屏」）、Wi-Fi、当前应用 |
| 通用 | 最后上报时间、在线 / 离线 / 挂机 / 熄屏徽标 |

- 手机 / Pad 离线阈值 15 分钟，电脑 45 秒。
- 熄屏单独标记为「熄屏」，最长保留 6 小时，期间不记录应用活动。

### 📊 数据统计
- **今日总结**：打开应用数、最常用应用、总使用时长。
- **Top Apps**：按使用时长排序的今日排行。
- **24 小时柱状图**：支持滚轮 / 拖拽横向查看，右侧并列天气组件。
- **累计使用曲线**：ApexCharts 面积图，CDN 走 jsDelivr 并带重试。
- **活跃热力墙**：GitHub 贡献墙样式，按「月 × 星期」排列，支持按日期翻页 / 日历回看。

### 🌤️ 天气与位置
- 首行固定格式：`IP：x.x.x.x，在：某地`。
- 城市留空时按服务器公网 IP 自动定位，不写死城市。
- 展示温度、天气描述、AQI，并在卡片底部生成对应建议。

### 💬 在线互动
- 实时在线人数（Socket 推送 + 10 秒轮询兜底）。
- 聊天室：昵称、消息、新消息红点与右下角通知。
- AI 助手：知识库问答、链接正文抓取、对话历史本地保存。
- 关闭「在线互动」后自动收起浮窗并调整页面列数。

### 🎨 体验细节
- **樱花粉（日间）/ 深紫夜色（夜间）**两套主题，切换带平滑过渡，偏好存 `localStorage`。
- 日间飘樱花花瓣，夜间换成随机明灭的萤火光点；深色为紫色氛围光 + 虚线分隔 + 发光卡片。
- 中 / 英 / 法 三语完整字典，语言偏好持久化。
- 入口落地页：全屏背景 + 毛玻璃卡片 + 鼠标视差 + 随机状态文案。
- 页面加载动画、彩带、鼠标点击粒子、标签页标题轮换、F12 防爬提示。
- 桌面 / 平板（≤1100px）/ 手机（≤768px）独立断点，手机端设备列表为左上角抽屉。

---

## 🛠️ 技术栈

### 服务端
| 技术 | 用途 |
|---|---|
| Node.js 20 + Express | HTTP 接口、静态资源 |
| Socket.IO 4 | 设备状态、活动流、聊天、在线人数实时推送 |
| Axios | 调用天气、IP 归属、AI（OpenAI 兼容）接口 |
| JSON 文件 | 活动、设备、聊天、音乐、位置持久化，无数据库 |
| dotenv | `.env` 配置管理 |

### 前端
| 技术 | 用途 |
|---|---|
| 原生 HTML / CSS / JS | 无构建步骤，改完即生效 |
| Vue 3（CDN） | 响应式状态、模板渲染 |
| ApexCharts（CDN） | 累计使用面积图 |
| Socket.IO Client | 实时数据接收 |
| i18n 字典 | 中 / 英 / 法 全量文案 |

### 上报端
| 平台 | 实现 |
|---|---|
| Windows | PowerShell 5.1（UTF-8 BOM），可打包为无控制台 EXE，后台静默运行 |
| Android | AutoTask 定时执行 shell，`GET /api/heartbeat` 上报 |
| HarmonyOS / Pad | AutoTask + `app_process` 调 Java 发起 HTTPS（绕开 busybox wget 不支持 TLS 的问题） |
| 其他 | 任何能发 HTTP 请求的脚本 / 设备 |

### 部署
| 组件 | 说明 |
|---|---|
| Docker | `node:20-alpine`，容器名 `stalk`，端口 8080 |
| Caddy / Nginx | 反向代理 + HTTPS（示例站点用 Caddy） |
| Ollama（可选） | 与 stalk 同处 `halo-net` 网络，服务名 `ollama` |

---

## 📁 项目结构

```
watchtogether/
├─ web/                     前端静态资源
│  ├─ index.html            入口落地页 + 监控面板结构
│  ├─ css/main.css          全部样式（樱花粉 / 夜色紫 + 三端响应式）
│  ├─ js/app.js             Vue 应用逻辑、Socket、图表、主题
│  ├─ js/i18n.js            中 / 英 / 法 翻译字典
│  ├─ js/effects.js         粒子、彩带、标题轮换等效果
│  └─ assets/               背景图 home-bg.webp、公安备案徽标
├─ server/
│  ├─ server.js             Express + Socket.IO 全部后端逻辑
│  ├─ package.json
│  ├─ .env.example          环境变量模板
│  ├─ ai/prompt.md          AI 人设（system prompt，改完即生效）
│  ├─ ai/knowledge/         AI 知识库（Markdown，按关键词检索注入）
│  └─ data/                 JSON 持久化数据
├─ agents/                  Windows 上报端脚本
├─ sample/                  AutoTask 上报格式示例（.xtsk）
├─ scripts/                 知识库构建等工具脚本
├─ deploy/                  Docker 相关配置
├─ deploy.ps1               一键推送并重启
├─ DEPLOY.md                部署与架构说明
└─ README.md
```

---

## 🚀 快速开始

### 1. 安装依赖

```bash
cd server
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

最少改一项：`SECRET_KEY`（上报端与服务端必须一致）。想用 AI 再加 `AI_*`。

### 3. 启动

```bash
cd server
node server.js
```

打开 <http://localhost:8080>。

> 端口用 8080 是为了避开 Windows 上被 Hyper-V / WSL 占用的 3000。

### 4. 第一次访问

- 会先看到入口落地页，点「进入监控面板」后进入 `#/app`。
- 顶栏可切主题、切语言、返回首页。
- 没有设备上报时，页面是空态，属正常。

---

## 🔌 接入设备

### 🪟 Windows

1. 打开 `agents/` 下的 PowerShell 脚本，填 `SERVER_URL` 与 `SECRET_KEY`。
2. 建议以计划任务方式开机自启，或打包成无窗口 EXE 后台静默运行。
3. 脚本会上报：前台进程、窗口标题（含浏览器当前标签页标题）、CPU、内存、电量、空闲时长。
4. 浏览器标题末尾的「内存使用率 - N MB/GB/KB」会被自动过滤。

> PowerShell 5.1 对无 BOM 的 UTF-8 脚本解析异常，脚本务必保存为 **UTF-8 with BOM**。

### 📱 Android（AutoTask）

1. 参考 `sample/` 里的 `.xtsk` 示例，在 AutoTask 中新建定时任务。
2. 定时调用：

```bash
curl "http://你的服务器:8080/api/heartbeat?key=SECRET_KEY&name=我的手机&type=phone&app=com.tencent.mm&detail=聊天"
```

3. 锁屏 / 解锁事件用 `screen off` / `screen on` 命令上报，不要伪装成普通应用。
4. 上报脚本统一使用 `/sdcard/` 路径，并把 `/data/local/tmp` 加进 PATH。

### 📱 HarmonyOS / Pad

默认 shell 通常没有 curl、且 busybox 的 wget 不支持 HTTPS，推荐：

- 用 `app_process` 调用系统 Java 执行 `HttpsGet.dex` 发请求；
- 或在 `tracker.sh` 里设置 `HTTP_TOOL=app_process` 强制走原生兜底；
- `NO_HTTP=1` 时脚本只维护本地 `tracker.txt`，用 `url` 子命令只输出拼好的 URL，由 AutoTask 自己发请求。

### 🎵 音乐 / 📍 位置（可选）

```bash
# 音乐
curl -X POST http://localhost:8080/api/music \
  -H "X-Auth-Key: SECRET_KEY" -H "Content-Type: application/json" \
  -d '{"device":"我的电脑","title":"夜曲","artist":"周杰伦","playing":true}'

# 位置
curl -X POST http://localhost:8080/api/location \
  -H "X-Auth-Key: SECRET_KEY" -H "Content-Type: application/json" \
  -d '{"device":"我的手机","lat":30.59,"lng":114.30}'
```

---

## ⚙️ 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8080` | 服务端口 |
| `SECRET_KEY` | `change-me-in-production` | 上报鉴权密钥（`X-Auth-Key`） |
| `WEATHER_CITY` | 空 | 天气城市；留空按公网 IP 定位 |
| `WEATHER_KEY` | 空 | 和风天气 Key（可选） |
| `AI_PROVIDER` | `openai` | `openai` / `ollama` / `zhipu` / `siliconflow` / `deepseek` |
| `AI_API_URL` | 预设 | OpenAI 兼容接口地址 |
| `AI_API_KEY` | 空 | 云端 API Key |
| `AI_MODEL` | 预设 | 模型名，不填用平台默认 |
| `OLLAMA_URL` | `http://localhost:11434` | 本地 Ollama（Docker 内用 `http://ollama:11434`） |
| `OLLAMA_MODEL` | `qwen2.5:7b` | 本地模型名 |
| `OLLAMA_NUM_CTX` | `4096` | 上下文窗口 |
| `OLLAMA_NUM_THREAD` | `2` | 推理线程（2 核机器勿超配） |
| `OLLAMA_NUM_PREDICT` | `260` | 单次最大输出 tokens |
| `AI_URL_MAX_CHARS` | `1200` | 抓取网页正文长度上限 |
| `AI_RETRIEVE_MAX_CHARS` | `800` | 知识库注入字数上限 |

### 用云端 AI（推荐）

本地小模型在 2 核机器上很吃力，云端更省心，都是 OpenAI 兼容、国内直连：

| 平台 | 配置 | 说明 |
|---|---|---|
| 智谱 BigModel | `AI_PROVIDER=zhipu` | `glm-4.7-flash` 免费（高峰期可能 429）；`glm-5.3-flash` 便宜稳定 |
| 硅基流动 | `AI_PROVIDER=siliconflow` | 9B 以下小模型限速免费，新用户有额度 |
| DeepSeek | `AI_PROVIDER=deepseek` | `deepseek-chat` 价格低、稳定 |

```ini
AI_PROVIDER=zhipu
AI_API_KEY=你的Key
AI_MODEL=glm-4.7-flash
```

切换云端后 `OLLAMA_*` 会被忽略，不用删。

---

## 🌐 API 接口

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| GET | `/api/health` | 否 | 健康检查 |
| POST | `/api/heartbeat` | `X-Auth-Key` | 上报设备与当前应用 |
| GET | `/api/heartbeat` | 否 | 参数式上报（AutoTask 用） |
| POST | `/api/screen-off` | `X-Auth-Key` | 上报熄屏 / 亮屏 |
| GET | `/api/devices` | 否 | 设备列表与在线状态 |
| GET | `/api/activity` | 否 | 活动流，支持 `?date=YYYY-MM-DD&limit=` |
| GET | `/api/summary/today` | 否 | 今日总结与 24 小时分布 |
| GET | `/api/summary/heatmap` | 否 | 活跃热力墙数据 |
| GET | `/api/insights` | 否 | 规则型洞察 |
| POST | `/api/music` | `X-Auth-Key` | 音乐播放上报 |
| POST | `/api/location` | `X-Auth-Key` | GPS / 位置轨迹上报 |
| GET / POST | `/api/chat` | 否 | 聊天历史 / 发送 |
| GET | `/api/viewers` | 否 | 实时在线人数 |
| GET | `/api/weather` | 否 | 天气与空气质量 |
| GET | `/api/myip` | 否 | 访客 IP 与归属地 |
| POST | `/api/ai` | 限流 | AI 对话，body：`{ message, history }` |

Socket.IO 事件：`init`、`activityUpdate`、`deviceStatusUpdate`、`viewerCountUpdate`、`chatMessage`。

---

## 🤖 AI 助手

- **人设模板**：`server/ai/prompt.md` 就是 system prompt，支持 `{{date}}`、`{{time}}`，保存即生效，无需重启。
- **知识库**：`server/ai/knowledge/*.md`，启动时读取；每次提问按关键词（中文二元组 + 英文词）打分，只注入最相关的几条，避免小模型上下文过载。
- **不做预设回答**：所有问题（包括「哪篇文章写得最深刻」这类主观题）都交给模型，基于知识库给出自己的判断，不再用写死的话术回避。
- **链接阅读**：消息里带链接时，服务端抓取网页正文（禁止访问内网 / 本机 / 云元数据地址，防 SSRF），直接返回摘要。
- **并发控制**：本地 Ollama 同一时间只跑一个生成任务，超出并发直接返回友好提示；云端 API 不受此限制。
- **重建博客知识库**：`node scripts/build-knowledge.mjs`

---

## 🔐 安全机制

- 上报接口 `X-Auth-Key` 鉴权，密钥仅在 `.env`。
- 敏感词过滤（聊天室 + AI）。
- 长度限制：聊天 500 字、昵称 20 字、AI 消息 2000 字。
- 接口限流（按 IP）：AI 12 次/分钟、聊天 20 条/分钟。
- SSRF 防护：外链抓取禁止内网、本机、云元数据地址。
- 前端 F12 / 右键防爬提示，页面不展示任何上报密钥。
- 建议部署时只暴露 443，8080 仅在内网 / Docker 网络可达。

---

## 🎨 主题与多语言

| 项 | 说明 |
|---|---|
| 主题 | **樱花粉（日间）** / **深紫夜色（夜间）**，顶栏按钮切换，带 450ms 过渡 |
| 装饰 | 日间 20 片樱花飘落；夜间 26 颗萤火随机明灭；均不挡点击 |
| 动效降级 | 系统开启「减少动态效果」时停止飘落，只保留静态装饰 |
| 偏好 | `localStorage` 的 `wt-theme-mode`，刷新不闪屏 |
| 语言 | 中 / 英 / 法，`wt-lang` 持久化，默认跟随浏览器 |
| 占位 | Vue 挂载前显示启动动画，避免 `{{ }}` 模板闪现 |

---

## 📦 部署

生产环境跑在 Ubuntu 的 Docker 里：容器名 `stalk`，端口 8080，由 Caddy 反向代理并自动签发证书。

```powershell
# Windows 本地一键推送 + 重启
.\deploy.ps1
```

```bash
# 或者在服务器上手动重启
docker restart stalk
docker ps --filter name=stalk
curl -s http://127.0.0.1:8080/api/health
```

详细步骤（Docker 配置、反向代理、Ollama 同网络调用、日志排查）见 [DEPLOY.md](./DEPLOY.md)。

---

## 🩺 常见问题

<details>
<summary><b>设备一直显示离线？</b></summary>

先看 `curl http://localhost:8080/api/devices` 是否有该设备。常见原因：`SECRET_KEY` 不一致、请求头没用 `X-Auth-Key`、上报脚本网络不通、手机端被系统省电策略杀掉。
</details>

<details>
<summary><b>在线人数只增不减？</b></summary>

不要用 `io.engine.clientsCount`，本项目统一用 `io.of('/').sockets.size`，并在 `disconnect` 后延后一个 tick 广播。
</details>

<details>
<summary><b>AI 返回空白 / no reply？</b></summary>

检查前端是否只读了 `reply` 而忽略 `error`，以及 `.env` 的 `AI_PROVIDER`、`AI_API_URL`、`AI_MODEL`、`AI_API_KEY` 是否齐全。本地模型超时会把提示写在 `reply` 里，不会白屏。
</details>

<details>
<summary><b>手机端显示「熄屏」而不是离线？</b></summary>

这是预期行为。熄屏单独标记，最长保留 6 小时；期间不记录应用活动，恢复前台应用后自动清除。
</details>

<details>
<summary><b>Pad 上报一直失败？</b></summary>

HarmonyOS 默认 shell 没有 curl，多数 busybox 的 wget 不支持 HTTPS。用 `app_process` 兜底，或设置 `HTTP_TOOL=app_process`。
</details>

<details>
<summary><b>天气一直显示同一个城市？</b></summary>

`WEATHER_CITY` 留空才会按公网 IP 定位；填了城市就固定用该城市。
</details>

---

## 📝 许可与备案

个人项目，仅供自用与学习参考。

<p align="center">
  © 2026 Landigo's Garden<br>
  鄂ICP备2025130292号 · 鄂公网安备42010402001653号
</p>
