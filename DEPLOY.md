# stalk · 视奸 部署与实现说明

多端实时监控面板：把电脑、手机、平板的当前应用和状态汇总到一个页面上，实时推送、实时观看。

---

## 1. 技术栈

| 层 | 技术 / 语言 |
| --- | --- |
| 前端 | 原生 HTML + CSS + JavaScript，Vue 3（CDN 版）做响应式渲染，Socket.IO 客户端接收实时事件 |
| 后端 | Node.js + Express（HTTP 接口与静态资源） + Socket.IO（WebSocket 推送） |
| 数据 | JSON 文件持久化（`server/data/*.json`），无数据库依赖 |
| 图表 | ApexCharts（24 小时活跃分布） |
| AI | 可切换 OpenAI 兼容接口或本地 Ollama（默认 `qwen2.5:1.5b`） |
| Windows 上报端 | PowerShell 5.1 + .NET（`agents/windows-agent.ps1`），外层可选无窗口 EXE 启动器 |
| Android / HarmonyOS 上报端 | shell 脚本（`sample/tracker.sh`）+ AutoTask 定时/事件触发 |
| 部署 | Ubuntu + Docker（Node 20 Alpine 镜像），与 Ollama 同处 `halo-net` 网络，Caddy 反向代理 |

一句话概括：**JavaScript（Node.js + 浏览器端）为主，PowerShell 和 shell 负责设备端上报。**

---

## 2. 架构

```
Windows Agent ─┐
Android/HarmonyOS AutoTask ─┼─ HTTP POST /api/heartbeat ─→ Node.js 服务 ─→ JSON 落盘
                             │                                    │
浏览器（Vue 3） ─── Socket.IO ──────────────────────────────────────┘
                                    │
                                    └─ /api/chat ─→ Ollama（知识库 + prompt.md）
```

- **上报**：设备端按事件或定时 POST 心跳，服务端写入 `devices` 并在内存里维护活动流。
- **推送**：任何状态变化通过 Socket.IO 广播 `deviceStatusUpdate` / `newActivity` / `viewerCount` 等事件。
- **兜底轮询**：在线观看人数每 10 秒、设备状态每 5 秒拉一次 REST 接口，防止推送丢包。
- **持久化**：`devices.json` / `activity.json` / `chat.json` / `music.json` / `location.json`，重启不丢历史。

---

## 3. 目录结构

```
watchtogether/
├─ web/                     # 前端（由 Express 直接托管）
│  ├─ index.html            # 单页应用：落地页 + 监控面板
│  ├─ css/main.css          # 全部样式（含响应式与深色主题）
│  ├─ js/app.js             # Vue 应用主体：状态、Socket、图表、AI 面板
│  ├─ js/i18n.js            # 中 / 英 / 法 三语字典
│  ├─ js/effects.js         # 鼠标粒子、标签页标题切换等动效
│  ├─ js/security.js        # F12 / DevTools 防爬提示
│  └─ assets/home-bg.jpg    # 首页背景横幅
├─ server/
│  ├─ server.js             # 全部后端逻辑（接口 + Socket + AI + 天气 + 地理位置）
│  ├─ package.json
│  ├─ data/                 # JSON 数据（持久化）
│  └─ ai/
│     ├─ prompt.md          # ★ AI 人设模板（system prompt）
│     └─ knowledge/         # ★ 知识库（.md / .txt，按文件名顺序注入）
│        └─ podcast-posts.md
├─ agents/                  # Windows 上报端
│  ├─ windows-agent.ps1
│  ├─ start-windows-agent.vbs
│  └─ stalk-launcher.cs
├─ sample/                  # AutoTask 上报格式示例
├─ scripts/
│  └─ build-knowledge.mjs   # 从 Halo 博客 API 生成 AI 知识库
├─ deploy/stalk-override.yml# docker compose override
└─ deploy.ps1               # 本地一键推送 + 重启
```

---

## 4. 服务器部署

### 4.1 前置条件

- Ubuntu 服务器，已安装 Docker。
- 已有 `halo-net` 网络（Halo 博客与 Ollama 所在网络；没有就 `docker network create halo-net`）。
- 反向代理（Caddy / Nginx）把域名指向容器。

### 4.2 上传代码

代码目录直接 bind mount 到容器 `/app`，所以更新代码只需覆盖文件 + 重启容器：

```bash
# 本地 Windows（项目根目录）
.\deploy.ps1          # 推送 server.js / web / ai 知识库并重启
.\deploy.ps1 -All     # 连同 package.json 一起推送
```

或手动：

```bash
scp -r web server root@<服务器IP>:/root/stalk/
ssh root@<服务器IP> "docker restart stalk"
```

### 4.3 启动容器

`deploy/stalk-override.yml` 已定义服务：

```yaml
services:
  stalk:
    image: docker.m.daocloud.io/library/node:20-alpine
    container_name: stalk
    networks: [halo-net]
    working_dir: /app/server
    command: node server.js
    volumes:
      - /root/stalk:/app
    restart: always
```

启动：

```bash
cd /root/stalk/deploy
docker compose -f stalk-override.yml up -d
```

> 注意：容器**不映射宿主端口**，由 `halo-net` 内的 Caddy 通过 `stalk:8080` 反代。
> 服务监听端口由 `.env` 的 `PORT` 控制，默认 **8080**（避开 Windows 侧 3000 被 Hyper-V 占用的问题）。

### 4.4 反向代理（Caddy 示例）

```caddy
stalk.minecraftglz.top {
    reverse_proxy stalk:8080
}
```

### 4.5 验证

```bash
curl -s http://127.0.0.1:8080/api/health
docker logs --tail 50 stalk
```

---

## 5. 环境变量（`server/.env`）

```ini
PORT=8080
SECRET_KEY=换成随机字符串          # 设备心跳鉴权（X-Auth-Key）

# 天气（留空则按服务器公网 IP 自动定位城市）
WEATHER_CITY=
WEATHER_KEY=

# AI：openai / ollama，或云端预设 zhipu / siliconflow / deepseek
# 云端只需 AI_PROVIDER + AI_API_KEY（URL 与默认模型自动带出），推荐智谱：
AI_PROVIDER=zhipu
AI_API_KEY=你的Key
AI_MODEL=glm-5.3-flash             # 免费版可换 glm-4.7-flash（高峰期可能 429）

# 本地 Ollama（AI_PROVIDER=ollama 时生效）
# OLLAMA_URL=http://ollama:11434   # 同一 docker 网络，用服务名而不是宿主端口
# OLLAMA_MODEL=qwen2.5:0.5b
# OLLAMA_NUM_CTX=4096

# 可选：AI 模板与知识库位置
# AI_PROMPT_FILE=/app/server/ai/prompt.md
# AI_KNOWLEDGE_DIR=/app/server/ai/knowledge
# AI_MAX_KNOWLEDGE_CHARS=12000
```

---

## 6. 设备端上报

### 6.1 Windows

```powershell
# 前台调试
powershell -ExecutionPolicy Bypass -File agents\windows-agent.ps1
# 后台静默（推荐）
wscript agents\start-windows-agent.vbs
```

- 读取当前前台窗口进程与浏览器标签页标题。
- CPU / 内存 / 电量 / 空闲时长一并上报。
- 空闲或停留在桌面超过 10 分钟上报「挂机」，而不是掉线。
- 脚本必须保存为 **UTF-8 with BOM**，否则 PowerShell 5.1 会按 GBK 解析中文并报语法错误。

### 6.2 Android / HarmonyOS

使用 AutoTask 调用 `sample/tracker.sh`，通过 `GET /api/heartbeat` 上报，服务端自动把包名映射成带语气的应用名。示例文件在 `sample/`。

### 6.3 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/heartbeat` | 设备心跳（`X-Auth-Key`） |
| GET | `/api/devices` | 设备列表 |
| GET | `/api/activity` | 活动流 |
| GET | `/api/viewers` | 实时在线观看人数 |
| POST | `/api/chat` | AI 对话 |
| GET | `/api/health` | 健康检查 |

---

## 7. AI 助手：模板与知识库

- **人设模板**：`server/ai/prompt.md`（服务器 `/root/stalk/server/ai/prompt.md`）
  - 每次对话都会重新读取，改完保存即生效；
  - 支持 `{{date}}` / `{{time}}` 占位符；
  - 可用 `.env` 的 `AI_PROMPT_FILE` 指向其他文件。
- **知识库**：`server/ai/knowledge/` 下的 `.md` / `.txt`，按文件名排序拼接进 system prompt。
  - 当前内容：`podcast-posts.md`，由博客 API 生成（70 篇文章索引 + 近期摘要）。
  - 重新生成：

```bash
node scripts/build-knowledge.mjs
```

- 知识库总字符上限由 `AI_MAX_KNOWLEDGE_CHARS` 控制（默认 12000），Ollama 侧用 `OLLAMA_NUM_CTX` 放大上下文。

---

## 8. 前端约定

- 路由用 hash：`#/` 落地页，`#/app` 监控面板。
- 主题只有 `light` / `dark` 两态，持久化在 `localStorage`。
- 语言 `zh` / `en` / `fr`，字典在 `js/i18n.js`，`t()` 缺失时回落到中文再回落到 key。
- 响应式断点：`1100px`（平板收窄侧栏）、`950px`（主网格单列）、`768px`（手机抽屉 + 单列卡片）。
- 页面底部固定 ICP 备案信息，head 内已挂 Umami / 百度统计。

---

## 9. 常见问题

| 现象 | 处理 |
| --- | --- |
| 改了代码刷新没变化 | `index.html` 已设置 `no-store`；CSS/JS 走强刷（Ctrl+F5） |
| 设备一直显示离线 | 检查 `X-Auth-Key` 是否与 `.env` 的 `SECRET_KEY` 一致 |
| AI 回答不到文章内容 | 确认知识库文件已上传；本地 Ollama 检查 `OLLAMA_URL` 用服务名与 `OLLAMA_NUM_CTX`，云端检查 `AI_MODEL` 是否正确 |
| AI 返回「服务器这会儿有点忙」 | 看 `docker logs stalk`：429 多为云端限流或免费模型过载，换 `AI_MODEL=glm-5.3-flash` |
| 首页背景图想换 | 直接覆盖 `web/assets/home-bg.webp`（建议 2.3:1 横幅） |
| 容器里没有 node_modules | bind mount 覆盖了镜像内容，首次进入执行 `docker exec stalk npm i --production` |
