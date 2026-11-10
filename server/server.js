require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;
const axios = require('axios');

// ========== 配置 ==========
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || 'change-me-in-production';
const WEB_DIR = path.join(__dirname, '..', 'web');
const DATA_DIR = path.join(__dirname, 'data');
// 留空则按服务器公网 IP 自动定位城市（不要再写死 Shanghai，否则人在哪都显示上海）
const WEATHER_CITY = process.env.WEATHER_CITY || '';
const WEATHER_KEY = process.env.WEATHER_KEY || ''; // 和风天气key，可选

// AI provider 抽象：
//   openai = OpenAI 兼容接口（AI_API_URL / AI_API_KEY / AI_MODEL）
//   ollama = 本地 Ollama（OLLAMA_URL / OLLAMA_MODEL），生产环境 Ubuntu Docker 里用
const AI_PROVIDER = (process.env.AI_PROVIDER || 'openai').toLowerCase();
// 云端预设：只填 AI_PROVIDER + AI_API_KEY 即可，URL 和默认模型自动带出
const AI_PRESETS = {
  zhipu: { url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-5.3-flash' },
  siliconflow: { url: 'https://api.siliconflow.cn/v1/chat/completions', model: 'zai-org/GLM-5.3-Flash' },
  deepseek: { url: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat' },
};
const AI_PRESET = AI_PRESETS[AI_PROVIDER] || {};
const AI_API_URL = process.env.AI_API_URL || AI_PRESET.url || '';
const AI_API_KEY = process.env.AI_API_KEY || '';
const AI_MODEL = process.env.AI_MODEL || AI_PRESET.model || 'gpt-4o-mini';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';
// 知识库会拼进 system prompt，默认上下文窗口必须放大，否则会被 Ollama 默认 2048/4096 截断
const OLLAMA_NUM_CTX = parseInt(process.env.OLLAMA_NUM_CTX || '4096', 10);
// 服务器只有 2 核；0.5b 用 2 线程即可，1.5b 那种大模型才会把整机拖死
const OLLAMA_NUM_THREAD = parseInt(process.env.OLLAMA_NUM_THREAD || '2', 10);
// 限制单次输出长度，避免小模型长篇大论把 CPU 长时间占住
const OLLAMA_NUM_PREDICT = parseInt(process.env.OLLAMA_NUM_PREDICT || '260', 10);
// 用户发链接时，服务端抓取网页正文再喂给模型（模型自己不能联网），正文长度上限
const AI_URL_MAX_CHARS = parseInt(process.env.AI_URL_MAX_CHARS || '1200', 10);

const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  '*',
];

// ========== 初始化 ==========
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(WEB_DIR, {
  setHeaders(res, filePath) {
    // 单页应用入口不缓存：改完代码刷新即可看到最新版（否则浏览器/CDN 会留旧页面）
    if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  },
}));

// ========== 数据存储 ==========
const DB = {
  // 设备在线状态：{ deviceId: { name, type, online, lastSeen, currentApp, battery, ip } }
  devices: {},
  // 活动时间线：[{ deviceId, deviceName, appName, packageName, detail, action, startTime, endTime, duration }]
  activityStream: [],
  // 聊天室：[{ id, nickname, message, timestamp, deviceId }]
  chat: [],
  // 每个设备当前活动：{ deviceId: { appName, activityPhrase, detail, startTime } }
  currentActivity: {},
  // 音乐播放状态：{ deviceId: { title, artist, album, duration, position, playing, todayPlays, todaySeconds, tracks: { key: {title, artist, count} }, date, updatedAt } }
  music: {},
  // 位置/轨迹：{ deviceId: { lat, lng, speed, maxSpeed, distance, altitude, place, source, track: [{lat,lng,t,speed}], updatedAt } }
  location: {},
};

const FILES = {
  devices: path.join(DATA_DIR, 'devices.json'),
  // 注意：这里的键必须和 DB 里的键一致。
  // 之前写成 stream，而 DB 里的键是 activityStream，
  // 导致 saveData('activityStream') 一直序列化 undefined 并抛错，活动流从未落盘。
  activityStream: path.join(DATA_DIR, 'activity.json'),
  chat: path.join(DATA_DIR, 'chat.json'),
  music: path.join(DATA_DIR, 'music.json'),
  location: path.join(DATA_DIR, 'location.json'),
};

function loadData() {
  for (const [key, file] of Object.entries(FILES)) {
    try {
      if (fs.existsSync(file)) {
        DB[key] = JSON.parse(fs.readFileSync(file, 'utf8'));
      }
    } catch (e) {
      console.error(`加载 ${file} 失败:`, e.message);
    }
  }
  // 初始化 currentActivity 从 activityStream 恢复
  for (const act of DB.activityStream) {
    if (act.endTime === null) {
      DB.currentActivity[act.deviceId] = {
        appName: act.appName,
        activityPhrase: act.activityPhrase || '',
        startTime: act.startTime,
      };
    }
  }
  console.log(`数据加载完成: ${Object.keys(DB.devices).length} 设备, ${DB.activityStream.length} 活动, ${DB.chat.length} 聊天`);
}

let writeQueue = Promise.resolve();
function saveData(key) {
  writeQueue = writeQueue.then(async () => {
    fs.writeFileSync(FILES[key], JSON.stringify(DB[key], null, 2));
  }).catch(e => console.error('保存失败:', e));
  return writeQueue;
}

// 活动流落盘节流：心跳很频繁（每 15s/台），每次都写十几 MB JSON 会把磁盘打满。
// 心跳只打脏标，由 15s 定时 tick 统一刷盘，最多丢 15s 数据。
let activityDirty = false;
function markActivityDirty() { activityDirty = true; }

loadData();

// ========== 工具函数 ==========
function getClientIp(req) {
  const f = req.headers['x-forwarded-for'];
  if (f) return (typeof f === 'string' ? f : f[0]).split(',')[0].trim();
  return req.socket.remoteAddress.replace('::ffff:', '');
}

// 今日 0 点（本地时区）的时间戳，供今日总结 / 洞察统计用
function todayStartTs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// 中文时长文案：45 分钟 / 2 小时 30 分钟
function formatDurationCN(sec) {
  sec = Math.floor(sec || 0);
  if (sec < 60) return sec + ' 秒';
  const m = Math.floor(sec / 60);
  if (m < 60) return m + ' 分钟';
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return h + ' 小时' + (rm ? ' ' + rm + ' 分钟' : '');
}

// AQI（美国 EPA 口径，与国内分级接近）→ 中文等级
function aqiLevel(aqi) {
  if (aqi == null) return '';
  if (aqi <= 50) return '优';
  if (aqi <= 100) return '良';
  if (aqi <= 150) return '轻度污染';
  if (aqi <= 200) return '中度污染';
  if (aqi <= 300) return '重度污染';
  return '严重污染';
}

// ===== IP 地理位置（带缓存，ipapi.co 免费接口有频率限制） =====
function isPrivateIp(ip) {
  if (!ip) return true;
  return ip === '::1' || ip === '127.0.0.1'
    || /^10\./.test(ip)
    || /^192\.168\./.test(ip)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
    || /^169\.254\./.test(ip)
    || /^f[cd]/i.test(ip) || /^fe80/i.test(ip);
}

const geoCache = new Map();    // 公网 IP -> { city, region, country }
const geoAttempted = new Set(); // 查过一次就不再重试，避免失败时反复打接口
let serverGeoPromise = null;   // 服务器自身出口 IP 的位置

async function fetchGeo(ip) {
  // ipapi.co 会返回 403（风控），这里改成两个都实测可用的免费接口，
  // 第一个失败就试第二个。ip-api.com 用 lang=zh-CN 直接返回中文地区名。
  const providers = [
    {
      url: ip ? `http://ip-api.com/json/${ip}?lang=zh-CN` : 'http://ip-api.com/json/?lang=zh-CN',
      pick: d => (d.status === 'success'
        ? { ip: d.query, city: d.city, region: d.regionName, country: d.country, lat: d.lat, lon: d.lon }
        : null),
    },
    {
      url: ip ? `https://ipwho.is/${ip}` : 'https://ipwho.is/',
      pick: d => (d.success
        ? { ip: d.ip, city: d.city, region: d.region, country: d.country, lat: d.latitude, lon: d.longitude }
        : null),
    },
  ];
  for (const p of providers) {
    try {
      const r = await axios.get(p.url, { timeout: 6000 });
      const info = p.pick(r.data);
      if (info && (info.city || info.region)) return info;
    } catch (e) { /* 换下一个接口 */ }
  }
  throw new Error('所有地理位置接口均失败');
}

function getServerGeo() {
  if (!serverGeoPromise) {
    // 失败时不缓存，下次心跳会再试一次
    serverGeoPromise = fetchGeo(null).catch(() => {
      serverGeoPromise = null;
      return null;
    });
  }
  return serverGeoPromise;
}

// 异步补全设备的地理位置；局域网设备回落到服务器自己的出口 IP
async function attachGeo(deviceId, ip) {
  try {
    let info, ipType;
    if (isPrivateIp(ip)) {
      info = await getServerGeo();
      ipType = 'lan';
      if (!info) return;
    } else {
      ipType = 'public';
      if (!geoCache.has(ip)) {
        if (geoAttempted.has(ip)) return;
        geoAttempted.add(ip);
        geoCache.set(ip, await fetchGeo(ip));
      }
      info = geoCache.get(ip);
    }
    const dev = DB.devices[deviceId];
    if (!dev || dev.ip !== ip) return; // 期间设备已换 IP 或下线，丢弃这次结果
    dev.ipType = ipType;
    dev.ipLocation = { city: info.city, region: info.region, country: info.country };
    dev.ipLat = info.lat;
    dev.ipLon = info.lon;
    if (ipType === 'lan') dev.wanIp = info.ip;
    saveData('devices');
    io.emit('deviceStatusUpdate', DB.devices);
  } catch (e) {
    // 地理位置只是锦上添花，失败不影响上报主流程
    console.warn('地理位置解析失败:', e.message);
  }
}

// 活动流保留上限：原来 500 条只够 ~2 天，导致贡献墙只有 1 天数据。
// 提高到 6 万条，覆盖约 180 天，足够「近 126 天」贡献墙展示。
// 每条 ~300 字节，6 万条约 18MB，对 3.3G 内存完全无压力。
const MAX_ACTIVITY = 60000;
const MAX_CHAT = 200;
const ONLINE_TIMEOUT = 45000; // 电脑端：45 秒无心跳判离线
// 移动端：AutoTask 只在「切换应用 / 熄屏 / 电量变化」等事件时上报，用户长时间停留在同一
// 应用里不会产生心跳，用 45 秒会把还在用的手机误判成离线。这里放宽到 15 分钟。
const ONLINE_TIMEOUT_MOBILE = 15 * 60 * 1000;
const SCREENOFF_MAX = 6 * 60 * 60 * 1000; // 熄屏设备最长保持「熄屏」展示 6 小时，超时才判离线
// 挂机：在桌面连续停留 10 分钟即判定挂机（电脑端 Agent 也会上报，这里兜底手机/Pad）
const DESKTOP_IDLE_MS = 10 * 60 * 1000;
// 挂机中的设备保持在线更久，避免电脑休眠后立刻掉成「离线」
const ONLINE_TIMEOUT_IDLE = 60 * 60 * 1000;

// 是否为移动端设备（手机/Pad）：这类设备只能事件驱动上报，没有定时心跳
function isMobileDevice(type) {
  return /android|phone|pad|ios|ipad|mobile/i.test(String(type || ''));
}

// 是否为「桌面」类应用：电脑桌面、手机/Pad 桌面（launcher/homescreen）
function isDesktopApp(name) {
  const s = String(name == null ? '' : name).trim().toLowerCase();
  if (!s) return false;
  return /桌面|launcher|主屏幕|主界面|启动器|^home$|^desktop$|home screen/.test(s);
}

// 判断上报的屏幕状态是否为「熄屏」
function isScreenOff(v) {
  const s = String(v == null ? '' : v).toLowerCase();
  if (!s) return false;
  return /off|息屏|熄屏|锁屏|locked|关屏|黑屏/.test(s);
}

function pruneOld() {
  if (DB.activityStream.length > MAX_ACTIVITY) {
    DB.activityStream = DB.activityStream.slice(-MAX_ACTIVITY);
    markActivityDirty();
  }
  if (DB.chat.length > MAX_CHAT) {
    DB.chat = DB.chat.slice(-MAX_CHAT);
    saveData('chat');
  }
}

// 定时清理离线设备标记
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, dev] of Object.entries(DB.devices)) {
    if (!dev.online) continue;
    const silent = now - dev.lastSeen;
    // 停在桌面超过 10 分钟：即使没有任何新上报，也标记为挂机（手机/Pad 常见）
    if (!dev.idle && !dev.screenOff && isDesktopApp(dev.currentApp)) {
      const since = dev.desktopSince || dev.lastSeen;
      if (now - since >= DESKTOP_IDLE_MS) {
        dev.idle = true;
        changed = true;
      }
    }
    // 手机/Pad 按事件上报，用更长的离线阈值，避免长时间停留同一应用被误判离线；
    // 挂机中的设备再放宽，避免人还在只是没操作就被判成离线
    const timeout = dev.idle
      ? ONLINE_TIMEOUT_IDLE
      : (isMobileDevice(dev.type) ? ONLINE_TIMEOUT_MOBILE : ONLINE_TIMEOUT);
    if (silent <= timeout) continue;
    // 熄屏中的设备不算离线：手机息屏后上报暂停，仍按「熄屏」展示；
    // 只有长时间没动静（真关机/断网）才判离线，避免一直挂着。
    if (dev.screenOff && silent <= SCREENOFF_MAX) continue;
    // 移动端停在桌面时没有新事件、也就没有心跳：先转成「挂机」而不是直接判离线
    if (!dev.idle && isDesktopApp(dev.currentApp) && silent <= ONLINE_TIMEOUT_IDLE) {
      dev.idle = true;
      changed = true;
      continue;
    }
    dev.online = false;
    changed = true;
    console.log(`设备离线: ${dev.name} (${id})`);
    // 结束当前活动
    const cur = DB.currentActivity[id];
    if (cur) {
      const idx = DB.activityStream.findIndex(a => a.deviceId === id && a.endTime === null);
      if (idx !== -1) {
        DB.activityStream[idx].endTime = now;
        DB.activityStream[idx].duration = Math.floor((now - DB.activityStream[idx].startTime) / 1000);
      }
      delete DB.currentActivity[id];
    }
  }
  if (changed) {
    saveData('devices');
    saveData('activityStream');
    io.emit('deviceStatusUpdate', DB.devices);
  }
  // 每 15s 统一把活动流落盘（心跳期间只打脏标，避免频繁写大文件）
  if (activityDirty) {
    saveData('activityStream');
    activityDirty = false;
  }
}, 15000);

// ========== 鉴权中间件 ==========
function auth(req, res, next) {
  const key = req.headers['x-auth-key'] || req.query.key;
  if (key !== SECRET_KEY) {
    return res.status(403).json({ error: '鉴权失败' });
  }
  next();
}

// ========== 限流与内容安全 ==========
// 同一 IP 在窗口期内的请求次数限制，防刷 / 防爬虫 / 防刷 AI
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 分钟

function makeRateLimit(max) {
  const hits = new Map();
  return function (req, res, next) {
    const ip = getClientIp(req);
    const now = Date.now();
    const logs = (hits.get(ip) || []).filter(t => now - t < RATE_LIMIT_WINDOW);
    if (logs.length >= max) {
      return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
    }
    logs.push(now);
    hits.set(ip, logs);
    next();
  };
}

const rateLimit = makeRateLimit(60);      // 心跳等设备接口
const aiRateLimit = makeRateLimit(12);    // AI 对话：每分钟 12 次
const chatRateLimit = makeRateLimit(20);  // 聊天室：每分钟 20 条

// 极简敏感内容拦截：命中明显违法违规/色情暴力词直接拒绝
const BLOCKED_WORDS = [
  '色情', '裸聊', '约炮', '招嫖', '卖淫', '嫖娼', '强奸', '迷奸', '幼女', '恋童',
  '吸毒', '冰毒', '海洛因', '贩毒', '赌博', '博彩', '洗钱', '枪支', '弹药', '炸弹', '恐怖袭击',
  'porn', 'nude', 'nsfw', 'rape', 'cocaine', 'heroin', 'meth', 'suicide', 'terrorist',
];

function isUnsafeContent(text) {
  const s = String(text || '').toLowerCase();
  return BLOCKED_WORDS.some(w => s.includes(w));
}

// deviceId / device 参数只允许常见安全字符，防止注入或日志攻击
function validateDeviceParam(req, res, next) {
  const device = req.body.deviceId || req.query.device;
  if (device != null && !/^[a-zA-Z0-9_.\-]{1,64}$/.test(String(device))) {
    return res.status(400).json({ error: 'device 参数格式不合法' });
  }
  next();
}

// ========== API 路由 ==========

// 根路径 - 返回单页应用
app.get('/', (req, res) => {
  res.sendFile(path.join(WEB_DIR, 'index.html'));
});

// 健康检查：供 Windows Agent 自动探测可用服务端（本地/公网二选一）
app.get('/api/health', (req, res) => {
  res.json({ ok: true, name: 'stalk', time: Date.now() });
});

// 手机/Pad 端（AutoTask）只能上报应用名和包名，没有语气短语。
// 这里做一层服务端兜底映射，让移动端也显示「正在使用 微信 聊天」这种语气。
// 电脑端 Agent 自带 activityPhrase，优先级更高，不会走到这里。
const PHRASE_MAP = {
  // 中文应用名
  '微信': '聊天', 'QQ': '聊天', '企业微信': '办公', '钉钉': '办公', '飞书': '办公',
  '支付宝': '付款', '淘宝': '逛淘宝', '京东': '逛京东', '拼多多': '逛拼多多',
  '抖音': '刷视频', '快手': '刷视频', '哔哩哔哩': '追番', '小红书': '种草', '微博': '刷微博', '知乎': '逛知乎',
  '网易云音乐': '听歌', 'QQ音乐': '听歌', '腾讯视频': '追剧', '爱奇艺': '追剧', '优酷': '追剧',
  'Chrome': '冲浪', 'Edge': '冲浪', '浏览器': '冲浪',
  '高德地图': '导航', '百度地图': '导航', '相机': '拍照', '相册': '看照片', '图库': '看照片',
  '设置': '调设置', '电话': '打电话', '短信': '发短信', '计算器': '算数', '时钟': '看时间',
  '文件管理': '找文件', '应用商店': '装应用', '王者荣耀': '打游戏', '和平精英': '打游戏', '原神': '打游戏',
  // 安卓包名
  'com.tencent.mm': '聊天', 'com.tencent.mobileqq': '聊天', 'com.tencent.wework': '办公',
  'com.alibaba.android.rimet': '办公', 'com.ss.android.lark': '办公',
  'com.eg.android.AlipayGphone': '付款', 'com.taobao.taobao': '逛淘宝', 'com.jingdong.app.mall': '逛京东',
  'com.xunmeng.pinduoduo': '逛拼多多',
  'com.ss.android.ugc.aweme': '刷视频', 'com.smile.gifmaker': '刷视频',
  'tv.danmaku.bili': '追番', 'com.xingin.xhs': '种草', 'com.sina.weibo': '刷微博', 'com.zhihu.android': '逛知乎',
  'com.netease.cloudmusic': '听歌', 'com.tencent.qqmusic': '听歌',
  'com.tencent.qqlive': '追剧', 'com.qiyi.video': '追剧', 'com.youku.phone': '追剧',
  'com.android.chrome': '冲浪', 'com.microsoft.emmx': '冲浪',
  'com.autonavi.minimap': '导航', 'com.baidu.BaiduMap': '导航',
  'com.android.camera': '拍照', 'com.android.gallery3d': '看照片', 'com.android.settings': '调设置',
  'com.android.dialer': '打电话', 'com.android.mms': '发短信',
  'com.android.calculator2': '算数', 'com.android.deskclock': '看时间', 'com.android.documentsui': '找文件',
  'com.tencent.tmgp.sgame': '打游戏', 'com.tencent.tmgp.pubgmhd': '打游戏', 'com.miHoYo.Yuanshen': '打游戏',
};

// 先查包名（更精确），再查应用名；都没有则返回空串（前端会退化成「正在使用 X」）
function derivePhrase(appName, packageName) {
  if (packageName && PHRASE_MAP[packageName]) return PHRASE_MAP[packageName];
  if (appName && PHRASE_MAP[appName]) return PHRASE_MAP[appName];
  return '';
}

// ===== 挂机语句（结合空闲时长）=====
// 每 IDLE_BUCKET_SEC 秒为一个「桶」，同桶内复用同一条语句，避免每次心跳都调 AI。
const IDLE_BUCKET_SEC = 120;
const idlePhraseCache = new Map(); // deviceId -> { bucket, text }

// 兜底模板（AI 未配置 / 调用失败时使用）
function idleTemplate(sec) {
  const m = Math.max(1, Math.round(sec / 60));
  const variants = [
    `人不在，机器空转了 ${m} 分钟`,
    `挂机 ${m} 分钟，鼠标怕是睡着了`,
    `离开屏幕 ${m} 分钟，键盘都在打呼噜`,
  ];
  return variants[Math.floor(sec / IDLE_BUCKET_SEC) % variants.length];
}

// 立即返回当前可用语句：命中缓存则用缓存的，否则用模板
function idlePhraseNow(deviceId, sec) {
  const bucket = Math.floor(sec / IDLE_BUCKET_SEC);
  const cached = idlePhraseCache.get(deviceId);
  if (cached && cached.bucket === bucket) return cached.text;
  return idleTemplate(sec);
}

// 异步刷新：进入新桶时调一次 AI（结合时长生成口语化语句），失败保留模板
async function refreshIdlePhrase(deviceId, sec) {
  const bucket = Math.floor(sec / IDLE_BUCKET_SEC);
  const cached = idlePhraseCache.get(deviceId);
  if (cached && (cached.bucket === bucket || cached.pending)) return;
  idlePhraseCache.set(deviceId, { bucket, text: (cached ? cached.text : idleTemplate(sec)), pending: true });

  const text0 = idleTemplate(sec);
  if (!aiConfigured()) {
    idlePhraseCache.set(deviceId, { bucket, text: text0 });
    return;
  }
  try {
    const m = Math.max(1, Math.round(sec / 60));
    const raw = await chatWithAI([
      { role: 'system', content: '你是调侃式状态播报器。用一句中文口语化地描述主人离开电脑多久了，20 字以内，只输出这一句，不要引号、不要解释。' },
      { role: 'user', content: `主人已经 ${m} 分钟没有任何操作，判定为挂机。` },
    ]);
    const text = String(raw || '').trim().replace(/^["“]|["”]$/g, '');
    idlePhraseCache.set(deviceId, { bucket, text: text || text0 });
  } catch {
    idlePhraseCache.set(deviceId, { bucket, text: text0 });
    return;
  }
  applyIdlePhrase(deviceId);
}

// 把最新挂机语句写回设备 + 当前活动，并广播给前端
function applyIdlePhrase(deviceId) {
  const cached = idlePhraseCache.get(deviceId);
  if (!cached) return;
  const dev = DB.devices[deviceId];
  if (dev && dev.currentApp && dev.currentApp.indexOf('挂机') !== -1) dev.activityPhrase = cached.text;
  const cur = DB.currentActivity[deviceId];
  if (cur && cur.appName && cur.appName.indexOf('挂机') !== -1) cur.activityPhrase = cached.text;
  io.emit('deviceStatusUpdate', DB.devices);
}

// 心跳统一处理：更新设备状态 + 记录活动切换。
// POST /api/heartbeat（电脑 Agent）与 GET /api/heartbeat（AutoTask/Shell）共用，
// 避免两处逻辑各写一份、改一处漏一处。
// detail 是「应用内二级信息」：B 站视频名、Trae/VS Code 打开的项目、歌名等。
function upsertDeviceAndActivity(opts) {
  const {
    deviceId, deviceName, deviceType, appName, packageName, detail,
    battery, isCharging, activityPhrase, ip, status, idle,
  } = opts;

  const now = Date.now();
  // 电脑端 Agent 自带 activityPhrase；手机/Pad 没有，用服务端映射兜底
  let phrase = activityPhrase || derivePhrase(appName, packageName);
  // 挂机：Agent 把 appName 置为「💤 挂机中」并带上空闲秒数 idle。
  // 先用缓存/模板给即时反馈，再异步让 AI 结合时长重写一句（不阻塞心跳）。
  const idleSec = Number(idle ?? (status && status.idleSeconds)) || 0;
  if (appName && appName.indexOf('挂机') !== -1) {
    phrase = idlePhraseNow(deviceId, idleSec);
    refreshIdlePhrase(deviceId, idleSec);
  }
  const prev = DB.devices[deviceId];

  // 富状态字段（CPU/内存/麦克风/路径、电量/温度/WiFi/心率/位置…）：
  // 本次上报带的字段覆盖旧值，没带的沿用上一次，避免闪烁或丢字段
  const prevStatus = (prev && prev.status) || {};
  const newStatus = {};
  for (const k of Object.keys(status || {})) {
    if (status[k] !== undefined && status[k] !== null && status[k] !== '') newStatus[k] = status[k];
  }
  const mergedStatus = { ...prevStatus, ...newStatus };

  DB.devices[deviceId] = {
    id: deviceId,
    name: deviceName,
    type: deviceType || 'unknown',
    online: true,
    lastSeen: now,
    currentApp: appName || (prev ? prev.currentApp : ''),
    activityPhrase: appName ? phrase : (prev ? prev.activityPhrase : ''),
    currentDetail: detail || (prev ? prev.currentDetail : ''),
    battery: battery ?? (prev ? prev.battery : null),
    isCharging: isCharging ?? (prev ? prev.isCharging : null),
    status: mergedStatus,
    serverTime: now,
    screenOff: false,
    screenOffSince: null,
    ip,
    // 地理位置是异步补全的，这里必须沿用上一次的结果，否则每轮心跳都会被清空
    ipType: prev ? prev.ipType : null,
    ipLocation: prev ? prev.ipLocation : null,
    ipLat: prev ? prev.ipLat : null,
    ipLon: prev ? prev.ipLon : null,
    wanIp: prev ? prev.wanIp : null,
  };

  // 熄屏状态：显式上报 scr 时按它取值；没带 scr 但本轮报了前台应用，则视为已亮屏
  const dev = DB.devices[deviceId];
  const scrRaw = status && status.screenState;
  dev.screenOff = (scrRaw != null && scrRaw !== '') ? isScreenOff(scrRaw) : (!appName && prev ? !!prev.screenOff : false);
  if (dev.screenOff) {
    dev.screenOffSince = (prev && prev.screenOff && prev.screenOffSince) || now;
    // 刚进入熄屏：结束当前活动，展示为「熄屏」（与锁屏一致的处理）
    if (!(prev && prev.screenOff)) {
      DB.currentActivity[deviceId] && delete DB.currentActivity[deviceId];
      for (const a of DB.activityStream) {
        if (a.deviceId === deviceId && a.endTime === null) {
          a.endTime = now;
          a.duration = Math.floor((now - a.startTime) / 1000);
        }
      }
      dev.currentApp = '🔒 熄屏';
      dev.activityPhrase = '';
      dev.currentDetail = '';
    }
  } else {
    delete dev.screenOffSince;
  }

  // 挂机判定：
  //   1. Agent 显式上报「挂机」
  //   2. 上报的空闲秒数 ≥ 10 分钟
  //   3. 在桌面连续停留 ≥ 10 分钟（手机/Pad 只能靠这条兜底）
  // 挂机期间设备保持 online，由离线定时器按更长的阈值处理。
  // 有些心跳（电量/亮屏等事件）不带 appName，此时沿用上一次的应用判断
  const effectiveApp = appName || (prev && prev.currentApp) || '';
  if (!dev.screenOff && isDesktopApp(effectiveApp)) {
    dev.desktopSince = (prev && prev.desktopSince) || now;
  } else {
    dev.desktopSince = null;
  }
  const desktopDwell = dev.desktopSince ? now - dev.desktopSince : 0;
  dev.idle = !dev.screenOff && (
    (appName && appName.indexOf('挂机') !== -1) ||
    idleSec >= DESKTOP_IDLE_MS / 1000 ||
    desktopDwell >= DESKTOP_IDLE_MS ||
    (!!(prev && prev.idle) && isDesktopApp(effectiveApp))
  );

  // 首次上报 / IP 变化 / 还没查到位置或经纬度时，异步去解析（不阻塞本次响应）
  if (!prev || prev.ip !== ip || !prev.ipLocation || prev.ipLat == null) attachGeo(deviceId, ip);

  // 检测应用切换 → 写入活动流（熄屏时不记录应用活动）
  if (dev.screenOff) {
    // 熄屏中：只保留设备状态，不产生应用活动
  } else if (appName) {
    const cur = DB.currentActivity[deviceId];
    if (!cur || cur.appName !== appName) {
      // 结束上一个
      if (cur) {
        const idx = DB.activityStream.findIndex(a => a.deviceId === deviceId && a.endTime === null);
        if (idx !== -1) {
          DB.activityStream[idx].endTime = now;
          DB.activityStream[idx].duration = Math.floor((now - DB.activityStream[idx].startTime) / 1000);
        }
      }
      // 开始新的
      const newAct = {
        id: `${deviceId}-${now}`,
        deviceId,
        deviceName,
        deviceType: deviceType || 'unknown',
        appName,
        activityPhrase: phrase,
        detail: detail || '',
        packageName: packageName || '',
        startTime: now,
        endTime: null,
        duration: null,
      };
      DB.activityStream.push(newAct);
      DB.currentActivity[deviceId] = { appName, activityPhrase: phrase, detail: detail || '', startTime: now };

      // 实时推送
      io.emit('activityStreamUpdate', { type: 'new', data: newAct });
    } else if (detail && cur.detail !== detail) {
      // 同一应用内内容发生变化（如切换视频 / 打开另一个项目）：
      // 不新起一条活动，只就地刷新 detail，避免活动流被刷屏。
      cur.detail = detail;
      DB.devices[deviceId].currentDetail = detail;
      const idx = DB.activityStream.findIndex(a => a.deviceId === deviceId && a.endTime === null);
      if (idx !== -1) DB.activityStream[idx].detail = detail;
      io.emit('activityStreamUpdate', { type: 'detail', data: { deviceId, detail } });
    }
  } else {
    // 仅心跳，无应用变化
    DB.currentActivity[deviceId] = DB.currentActivity[deviceId] || { appName: '', activityPhrase: '', detail: '', startTime: now };
  }

  pruneOld();
  saveData('devices');
  markActivityDirty();
  io.emit('deviceStatusUpdate', DB.devices);

  return DB.devices[deviceId];
}

// 心跳/注册 - 设备定期上报存活 + 当前应用
// POST /api/heartbeat { deviceId, deviceName, deviceType(phone|pad|computer), appName, packageName, detail, battery, isCharging, status:{...} }
// status 为富状态字段：电脑 cpu/mem/mic/path/windowTitle；手机 wifi/mobileData/dnd/ringer/
// connected/heartRate/heartMax/heartAvg/heartAgo/locationText/temp/model/lastUnlock/lastScreenOff/screenState/deviceTime
app.post('/api/heartbeat', auth, rateLimit, validateDeviceParam, (req, res) => {
  const { deviceId, deviceName, deviceType, appName, packageName, detail, battery, isCharging, activityPhrase, status, idle } = req.body;
  if (!deviceId || !deviceName) {
    return res.status(400).json({ error: '缺少 deviceId/deviceName' });
  }
  const dev = upsertDeviceAndActivity({
    deviceId, deviceName, deviceType, appName, packageName, detail,
    battery, isCharging, activityPhrase, status, idle, ip: getClientIp(req),
  });
  res.json({ success: true, devices: DB.devices, device: dev });
});

// GET /api/heartbeat - 供 AutoTask/Shell 脚本通过 wget 上报
// query: device=设备ID, pkg=前台包名, detail=应用内二级信息（可选）, name=显示名（可选）
// 移动端富状态用短别名透传：bat/temp/chg/scr/wifi/data/dnd/ring/conn/hr/hrmax/hravg/hrago/loc/model/unlock/off/devtime
app.get('/api/heartbeat', rateLimit, validateDeviceParam, (req, res) => {
  const device = req.query.device;
  const pkg = req.query.pkg;
  if (!device) return res.status(400).json({ error: '缺少 device' });

  const q = req.query;
  const status = {
    // 「熄屏」文本统一：移动端上报的 scr 可能是「已息屏/熄屏/off」等写法，
    // 这里一律归一成「熄屏」/「亮屏」，保证设备卡片的状态框与角标文案一致
    temp: q.temp,
    screenState: q.scr ? (isScreenOff(q.scr) ? '熄屏' : '亮屏') : undefined,
    wifi: q.wifi, mobileData: q.data,
    dnd: q.dnd, ringer: q.ring, connected: q.conn, heartRate: q.hr,
    heartMax: q.hrmax, heartAvg: q.hravg, heartAgo: q.hrago, locationText: q.loc,
    model: q.model, lastUnlock: q.unlock, lastScreenOff: q.off, deviceTime: q.devtime,
  };

  // 直接用包名作应用名；derivePhrase 会查 PHRASE_MAP 得到语气词
  upsertDeviceAndActivity({
    deviceId: device,
    deviceName: req.query.name || device,
    deviceType: req.query.type || 'android',
    appName: pkg || '',
    packageName: pkg || '',
    detail: req.query.detail || '',
    battery: q.bat != null ? parseInt(q.bat, 10) : undefined,
    isCharging: q.chg != null ? (q.chg === '1' || q.chg === 'true') : undefined,
    status,
    ip: getClientIp(req),
  });

  res.json({ success: true });
});

// 锁屏事件 - 结束当前活动
// POST /api/screen-off { deviceId, deviceName }
app.post('/api/screen-off', auth, (req, res) => {
  const { deviceId, deviceName } = req.body;
  if (!deviceId) return res.status(400).json({ error: '缺少 deviceId' });

  const now = Date.now();
  DB.devices[deviceId] = DB.devices[deviceId] || {
    id: deviceId, name: deviceName || deviceId, type: 'unknown',
    online: true, lastSeen: now, currentApp: '🔒 熄屏', activityPhrase: '', currentDetail: '',
    battery: null, isCharging: null, ip: getClientIp(req),
  };
  DB.devices[deviceId].online = true;
  DB.devices[deviceId].lastSeen = now;
  DB.devices[deviceId].currentApp = '🔒 熄屏';
  DB.devices[deviceId].activityPhrase = '';
  DB.devices[deviceId].currentDetail = '';

  // 结束当前活动
  const cur = DB.currentActivity[deviceId];
  if (cur) {
    const idx = DB.activityStream.findIndex(a => a.deviceId === deviceId && a.endTime === null);
    if (idx !== -1) {
      DB.activityStream[idx].endTime = now;
      DB.activityStream[idx].duration = Math.floor((now - DB.activityStream[idx].startTime) / 1000);
    }
    delete DB.currentActivity[deviceId];
  }

  // 记录锁屏事件
  DB.activityStream.push({
    id: `${deviceId}-lock-${now}`,
    deviceId, deviceName: deviceName || deviceId,
    deviceType: DB.devices[deviceId].type,
    appName: '🔒 熄屏', packageName: '',
    startTime: now, endTime: null, duration: null,
  });

  saveData('devices');
  markActivityDirty();
  io.emit('deviceStatusUpdate', DB.devices);
  io.emit('activityStreamUpdate', { type: 'new', data: DB.activityStream[DB.activityStream.length - 1] });
  res.json({ success: true });
});

// ===== 查询接口 =====

// 获取所有设备状态
app.get('/api/devices', (req, res) => {
  res.json(DB.devices);
});

// 获取活动时间线（支持 limit 参数；date=YYYY-MM-DD 时按本地日期筛选，供前端按天回看历史）
app.get('/api/activity', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  let stream = DB.activityStream;
  const date = req.query.date;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, d] = date.split('-').map(Number);
    const dayStart = new Date(y, m - 1, d).getTime();
    const dayEnd = new Date(y, m - 1, d + 1).getTime();
    stream = stream.filter(a => a.startTime >= dayStart && a.startTime < dayEnd);
  }
  res.json(stream.slice(-limit).reverse());
});

// 获取实时活动（当前每个设备正在做什么 + 已用时长）
app.get('/api/activity/current', (req, res) => {
  const now = Date.now();
  const result = {};
  for (const [id, dev] of Object.entries(DB.devices)) {
    const cur = DB.currentActivity[id];
    result[id] = {
      device: dev,
      currentApp: cur ? cur.appName : (dev.currentApp || '未知'),
      activityPhrase: cur ? (cur.activityPhrase || '') : (dev.activityPhrase || ''),
      duration: cur ? Math.floor((now - cur.startTime) / 1000) : 0,
    };
  }
  res.json(result);
});

// ===== 今日总结 =====
// 基于 DB.activityStream 当日数据统计（锁屏条目不计入应用使用）。
app.get('/api/summary/today', (req, res) => {
  const start = todayStartTs();
  const now = Date.now();
  const deviceId = req.query.device || ''; // 指定设备时只统计该设备今天的数据
  const perAppMap = new Map(); // appName -> { seconds, count }
  const devicesSet = new Set();
  let totalSeconds = 0;
  let lockSeconds = 0;
  let activityCount = 0;

  // 按小时(0~23)分布的使用时长，用于「活跃时段分布图」
  const hourly = new Array(24).fill(0);
  // 把一个时间区间的秒数拆分到对应的小时桶里（跨小时的活动按段累加）
  function addToHourly(s, e) {
    if (e <= s) return;
    let cur = s;
    while (cur < e) {
      const d = new Date(cur);
      const h = d.getHours();
      const nextHour = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h + 1, 0, 0, 0).getTime();
      const sec = Math.floor((Math.min(e, nextHour) - cur) / 1000);
      if (sec > 0) hourly[h] += sec;
      cur = nextHour;
    }
  }

  for (const act of DB.activityStream) {
    if (act.startTime < start) continue;
    if (deviceId && act.deviceId !== deviceId) continue;
    const sec = act.duration != null ? act.duration : Math.floor(((act.endTime || now) - act.startTime) / 1000);
    if (act.appName === '🔒 熄屏') {
      lockSeconds += sec;
      // 锁屏也计入时段分布（反映你什么时候在休息）
      addToHourly(act.startTime, act.endTime || now);
      continue;
    }
    totalSeconds += sec;
    activityCount += 1;
    devicesSet.add(act.deviceId);
    addToHourly(act.startTime, act.endTime || now);
    const cur = perAppMap.get(act.appName) || { app: act.appName, seconds: 0, count: 0 };
    cur.seconds += sec;
    cur.count += 1;
    perAppMap.set(act.appName, cur);
  }

  const perApp = [...perAppMap.values()].sort((a, b) => b.seconds - a.seconds);
  res.json({
    date: start,
    openedApps: perApp.length,           // 打开应用数（去重）
    totalSeconds,                        // 总使用时长（秒）
    lockSeconds,                         // 锁屏时长
    activityCount,                       // 活动次数
    deviceCount: devicesSet.size,
    mostUsed: perApp[0] || null,         // 最常使用
    perApp: perApp.slice(0, 10),         // 应用时长排行
    hourly,                              // 0~23 点各小时使用秒数（含锁屏）
  });
});

// ===== 活跃时段热力墙（GitHub 贡献墙风格：按「周 × 星期」排列）=====
// 返回最近 N 天的「每日活跃总时长」，并按周切分（每列一周，行 = 周日~周六）。
// weeks: [[{date, seconds, dow} ×7], ...]，前端据此渲染成 GitHub 日历热力墙（不再按小时）。
app.get('/api/summary/heatmap', (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days) || 126, 7), 371);
  const deviceId = req.query.device || ''; // 指定设备时只统计该设备
  const nowTs = Date.now();
  const now = new Date(nowTs);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  // 起点回溯到周日，保证每一列都是完整的一周
  let startTs = todayStart - (days - 1) * 86400000;
  startTs -= new Date(startTs).getDay() * 86400000;

  const dayKey = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  };
  const cells = [];
  const dayIdx = new Map();
  for (let t = startTs; t <= todayStart; t += 86400000) {
    const d = new Date(t);
    dayIdx.set(dayKey(t), cells.length);
    cells.push({ date: t, seconds: 0, dow: d.getDay() });
  }

  // 按天累加活动时长（跳过锁屏，代表真正的「活跃」时间）
  for (const act of DB.activityStream) {
    if (act.appName === '🔒 熄屏') continue;
    if (deviceId && act.deviceId !== deviceId) continue;
    const end = Math.min(act.endTime || nowTs, nowTs);
    let cur = Math.max(act.startTime, startTs);
    while (cur < end) {
      const d = new Date(cur);
      const nextDay = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
      const idx = dayIdx.get(dayKey(cur));
      if (idx === undefined) { cur = nextDay; continue; }
      const sec = Math.floor((Math.min(end, nextDay) - cur) / 1000);
      if (sec > 0) cells[idx].seconds += sec;
      cur = nextDay;
    }
  }

  // 按周切分：每 7 天一周，周日开头
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  let max = 0;
  for (const c of cells) if (c.seconds > max) max = c.seconds;

  res.json({ days: cells.length, weeks, max, start: startTs, end: todayStart });
});

// ===== AI 智能总结 =====
// 规则引擎生成洞察（不依赖大模型也能用），覆盖：
// 应用时长提醒 / 当前专注 / 音乐循环 / 运动配速 / 天气空气质量 / 作息 / 电量 / 实时在线
// 数据源不足的条目自动跳过，不硬编造。?ai=1 时额外让 AI（OpenAI 或 Ollama）说一段总结。
function buildInsights(weather, deviceId) {
  const out = [];
  const now = Date.now();
  const start = todayStartTs();
  const ownDevice = (id) => !deviceId || id === deviceId; // 指定设备时只看该设备的数据

  // 1) 今日各设备各应用累计时长 → 超过 30 分钟提醒
  const agg = new Map();
  for (const act of DB.activityStream) {
    if (act.startTime < start || act.appName === '🔒 熄屏') continue;
    if (!ownDevice(act.deviceId)) continue;
    const sec = act.duration != null ? act.duration : Math.floor(((act.endTime || now) - act.startTime) / 1000);
    if (sec <= 0) continue;
    const key = `${act.deviceId}|${act.appName}`;
    const cur = agg.get(key) || { app: act.appName, phrase: act.activityPhrase || '', seconds: 0 };
    cur.seconds += sec;
    agg.set(key, cur);
  }
  const ranked = [...agg.values()].sort((a, b) => b.seconds - a.seconds);
  // 不同应用配不同的调侃语尾
  const appEnding = (app) => {
    const a = (app || '').toLowerCase();
    if (a.includes('edge') || a.includes('chrome') || a.includes('firefox') || a.includes('浏览器')) return '不知又在看些什么';
    if (a.includes('trae') || a.includes('code') || a.includes('idea') || a.includes('vscode') || a.includes('编程') || a.includes('敲代码')) return '可能又在忙项目';
    if (a.includes('微信') || a.includes('wechat') || a.includes('qq') || a.includes('钉钉') || a.includes('飞书')) return '聊天聊得挺欢';
    if (a.includes('bilibili') || a.includes('b站') || a.includes('抖音') || a.includes('douyin') || a.includes('youtube')) return '刷视频停不下来';
    if (a.includes('word') || a.includes('excel') || a.includes('ppt') || a.includes('powerpoint') || a.includes('wps')) return '文档搬砖中';
    if (a.includes('游戏') || a.includes('game') || a.includes('原神') || a.includes('崩铁') || a.includes('终末地')) return '打游戏打得不亦乐乎';
    if (a.includes('音乐') || a.includes('music') || a.includes('网易云') || a.includes('qq音乐')) return '听得挺陶醉';
    return '该歇会儿了';
  };
  ranked.filter(r => r.seconds >= 1800).slice(0, 2).forEach(r => {
    out.push({
      icon: '⏰', tag: '应用',
      text: `你已经在「${r.app}」上花了 ${formatDurationCN(r.seconds)}${r.phrase ? '（' + r.phrase + '）' : ''}，${appEnding(r.app)}`,
    });
  });

  // 2) 当前正在专注的应用（超过 1 小时）
  for (const [id, cur] of Object.entries(DB.currentActivity)) {
    if (!ownDevice(id)) continue;
    const dev = DB.devices[id];
    if (!dev || !dev.online || !cur.appName) continue;
    const sec = Math.floor((now - cur.startTime) / 1000);
    if (sec >= 3600) {
      out.push({
        icon: '💻', tag: '专注',
        text: `${dev.name} 已经专注「${cur.appName}」${formatDurationCN(sec)}，注意休息眼睛`,
      });
    }
  }

  // 3) 音乐
  for (const [id, m] of Object.entries(DB.music)) {
    if (!ownDevice(id)) continue;
    if (!m || !m.title) continue;
    // 今天循环最多的一首
    const top = Object.values(m.tracks || {}).sort((a, b) => b.count - a.count)[0];
    if (top && top.count >= 2) {
      out.push({ icon: '🎵', tag: '音乐', text: `这首《${top.title}》你今天循环了 ${top.count} 遍` });
    }
    if (m.todayPlays >= 1) {
      out.push({ icon: '🎧', tag: '音乐', text: `今日已播放 ${m.todayPlays} 首，累计 ${formatDurationCN(m.todaySeconds)}` });
    }
  }

  // 4) 位置 / 运动（GPS / GPX 上报）
  for (const [id, loc] of Object.entries(DB.location)) {
    if (!ownDevice(id)) continue;
    if (!loc) continue;
    const dev = DB.devices[id];
    const who = dev ? dev.name : id;
    if (loc.distance != null && loc.distance > 0) {
      // 兼容上报的是米还是公里（>200 视为米）
      const km = loc.distance > 200 ? loc.distance / 1000 : loc.distance;
      out.push({ icon: '🚴', tag: '运动', text: `${who} 今天运动了 ${km.toFixed(1)}km，消耗约 ${Math.round(km * 27)} 卡路里` });
    }
    if (loc.speed != null && loc.speed > 0) {
      const max = (loc.maxSpeed || loc.speed).toFixed(1);
      out.push({
        icon: '🏃', tag: '运动',
        text: `当前速度 ${loc.speed.toFixed(1)}km/h · 最高 ${max}km/h${loc.speed > 25 ? '，速度有点快，注意安全' : ''}`,
      });
    }
    if (loc.place) {
      out.push({ icon: '📍', tag: '位置', text: `当前位置：${loc.place}` });
    }
  }

  // 5) 天气 / 空气质量
  if (weather) {
    if (weather.text && weather.temp != null && weather.temp !== '') {
      const t = Number(weather.temp);
      const nice = /晴|少云|多云/.test(weather.text) && t >= 10 && t <= 30;
      out.push({
        icon: '🌤️', tag: '天气',
        text: `${weather.city || ''} ${weather.text} ${weather.temp}°C，${nice ? '外面天气不错，出去走走吧' : '注意增减衣物'}`,
      });
    }
    if (weather.aqi != null) {
      out.push({
        icon: '😷', tag: '空气',
        text: `AQI ${weather.aqi} - ${weather.aqiLevel || ''}${weather.aqi > 100 ? '，空气质量不好，少出门' : ''}`,
      });
    }
  }

  // 6) 作息：锁屏时长 + 深夜提醒
  let lockSeconds = 0;
  for (const act of DB.activityStream) {
    if (act.startTime < start || act.appName !== '🔒 熄屏') continue;
    if (!ownDevice(act.deviceId)) continue;
    lockSeconds += act.duration != null ? act.duration : Math.floor(((act.endTime || now) - act.startTime) / 1000);
  }
  const hour = new Date().getHours();
  if (hour >= 22 || hour < 6) {
    out.push({
      icon: '🌙', tag: '作息',
      text: lockSeconds > 0
        ? `今天已锁屏 ${formatDurationCN(lockSeconds)}，夜深了，该睡觉了，明天还要早起`
        : '夜深了，你该睡觉了，明天还要早起',
    });
  }

  // 7) 电量
  for (const [id, dev] of Object.entries(DB.devices)) {
    if (!ownDevice(id)) continue;
    if (dev.battery != null && dev.battery <= 20 && !dev.isCharging) {
      out.push({ icon: '🔋', tag: '设备', text: `${dev.name} 电量只剩 ${dev.battery}%，记得充电` });
    }
  }

  return out;
}

app.get('/api/insights', async (req, res) => {
  // 按设备分离：带 device 时，洞察只用该设备的数据与该设备所在地的天气
  const devId = req.query.device || '';
  const dev = devId ? DB.devices[devId] : null;
  const geo = dev ? {
    ip: dev.ip,
    city: dev.ipLocation && dev.ipLocation.city,
    region: dev.ipLocation && dev.ipLocation.region,
    lat: dev.ipLat,
    lon: dev.ipLon,
  } : null;
  let weather = null;
  try { weather = await getWeatherData(geo); } catch (e) { /* 天气拿不到不影响其它洞察 */ }
  const insights = buildInsights(weather, devId);

  let aiText = '';
  if (req.query.ai === '1' && aiConfigured()) {
    try {
      const brief = insights.map(i => `- ${i.text}`).join('\n') || '（今天还没有监测到活动）';
      aiText = await chatWithAI([
        { role: 'system', content: '你是贴心又懂生活的数字助理，用中文一句话总结用户今天的数字生活，不超过 80 字，语气自然亲切。' },
        { role: 'user', content: `以下是今天监测到的数据点：\n${brief}\n请用一句话总结。` },
      ]);
    } catch (e) {
      aiText = '（AI 总结失败：' + e.message + '）';
    }
  }

  res.json({ generatedAt: Date.now(), aiText, insights });
});

// ===== 音乐上报（留好数据入口，供音乐洞察使用） =====
// POST /api/music { deviceId, title, artist, album, duration, position, playing, event }
// event: change(默认，切歌) | loop(同一首重播)
app.post('/api/music', auth, (req, res) => {
  const { deviceId, title, artist, album, duration, position, playing, event } = req.body;
  if (!deviceId) return res.status(400).json({ error: '缺少 deviceId' });

  const now = Date.now();
  const today = new Date().toDateString();
  const prev = DB.music[deviceId];
  if (!prev || prev.date !== today) {
    DB.music[deviceId] = {
      deviceId, date: today, todayPlays: 0, todaySeconds: 0,
      trackKey: '', tracks: {},
      title: '', artist: '', album: '', duration: null, position: null, playing: false,
    };
  }
  const m = DB.music[deviceId];
  if (!m.tracks) m.tracks = {};
  const trackKey = `${title || ''}|${artist || ''}`;
  const isNewTrack = !!title && trackKey !== m.trackKey;
  const isLoop = event === 'loop' && !!title;

  // 切歌或重播都算"又听了一遍"：今日播放次数 +1，并累计该曲目当天的循环次数
  if (isNewTrack || isLoop) {
    m.todayPlays += 1;
    const t = m.tracks[trackKey] || { title, artist: artist || '', count: 0 };
    t.count += 1;
    t.title = title || t.title;
    if (artist != null) t.artist = artist;
    m.tracks[trackKey] = t;
    if (isNewTrack) m.trackKey = trackKey;
  }

  // 累计今日听歌时长：按两次上报的 position 增量近似（过滤异常跳变）
  if (playing && position != null && prev && prev.date === today
      && prev.title === (title || prev.title) && prev.position != null) {
    const delta = position - prev.position;
    if (delta > 0 && delta <= 30) m.todaySeconds += delta;
  }

  if (title) m.title = title;
  if (artist != null) m.artist = artist;
  if (album != null) m.album = album;
  if (duration != null) m.duration = duration;
  if (position != null) m.position = position;
  if (playing != null) m.playing = playing;
  m.updatedAt = now;

  saveData('music');
  io.emit('musicUpdate', { deviceId, data: m });
  res.json({ success: true, music: m });
});

// ===== 位置 / 轨迹上报（GPS / GPX，留好数据入口） =====
// POST /api/location { deviceId, lat, lng, speed, maxSpeed, distance, altitude, place, source }
app.post('/api/location', auth, (req, res) => {
  const { deviceId, lat, lng, speed, maxSpeed, distance, altitude, place, source } = req.body;
  if (!deviceId || lat == null || lng == null) {
    return res.status(400).json({ error: '缺少 deviceId/lat/lng' });
  }
  const now = Date.now();
  const prev = DB.location[deviceId];
  const maxSeen = Math.max(maxSpeed || 0, (prev && prev.maxSpeed) || 0, speed || 0);
  const loc = DB.location[deviceId] = {
    deviceId, lat, lng,
    speed: speed ?? (prev ? prev.speed : null),
    maxSpeed: maxSeen || null,
    distance: distance ?? (prev ? prev.distance : null),
    altitude: altitude ?? (prev ? prev.altitude : null),
    place: place ?? (prev ? prev.place : null),
    source: source || (prev ? prev.source : 'gps'),
    updatedAt: now,
    // GPX 轨迹点（保留最近 500 个）
    track: ((prev && prev.track) || []).concat([{ lat, lng, t: now, speed: speed ?? null }]).slice(-500),
  };
  saveData('location');
  io.emit('locationUpdate', { deviceId, data: loc });
  res.json({ success: true });
});

// ===== 聊天室 =====

// 获取聊天历史
app.get('/api/chat', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(DB.chat.slice(-limit));
});

// 发送聊天（REST方式，也支持Socket.IO）
app.post('/api/chat', chatRateLimit, (req, res) => {
  const { nickname, message, deviceId } = req.body || {};
  if (!message || !nickname) {
    return res.status(400).json({ error: '缺少 nickname/message' });
  }
  if (String(message).length > 500 || String(nickname).length > 20) {
    return res.status(400).json({ error: '内容过长' });
  }
  if (isUnsafeContent(message) || isUnsafeContent(nickname)) {
    return res.status(400).json({ error: '内容包含不当信息，已被拦截' });
  }
  const entry = {
    id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    nickname: nickname.slice(0, 20),
    message: message.slice(0, 500),
    timestamp: Date.now(),
    deviceId: deviceId || null,
  };
  DB.chat.push(entry);
  pruneOld();
  saveData('chat');
  io.emit('chatUpdate', { type: 'new', data: entry });
  res.json(entry);
});

// ===== 在线观看人数 =====
// 通过 Socket.IO 连接数统计，REST接口提供查询
app.get('/api/viewers', (req, res) => {
  res.json({ viewers: currentViewers() });
});

// ===== 天气接口 =====
// 空气质量：open-meteo 免费接口，用服务器定位的经纬度查（无需 key）
async function fetchAqi(lat, lon) {
  if (lat == null || lon == null) return null;
  try {
    const r = await axios.get('https://air-quality-api.open-meteo.com/v1/air-quality', {
      params: { latitude: lat, longitude: lon, current: 'pm2_5,us_aqi' },
      timeout: 6000,
    });
    const c = (r.data && r.data.current) || {};
    if (c.us_aqi == null) return null;
    const aqi = Math.round(c.us_aqi);
    return { aqi, aqiLevel: aqiLevel(aqi), pm25: c.pm2_5 };
  } catch (e) {
    return null; // 空气质量拿不到不影响天气主流程
  }
}

// 天气数据（缓存 10 分钟），/api/weather 与 /api/insights 共用。
// geoOverride 传入时按该地理位置查询（用于按设备分离：显示该设备 IP + 所在地天气）；
// 不传则用服务器自身位置。
const weatherCacheMap = new Map(); // key -> { at, data }
async function getWeatherData(geoOverride) {
  const key = geoOverride ? ('dev:' + (geoOverride.ip || geoOverride.city || '')) : 'server';
  const hit = weatherCacheMap.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.data;

  // 城市来源优先级：.env 的 WEATHER_CITY（仅服务器位置生效）> 传入位置 > 服务器公网 IP 自动定位
  const geo = geoOverride || await getServerGeo();
  const city = geoOverride
    ? ((geo && (geo.city || geo.region)) || '')
    : (WEATHER_CITY || (geo && (geo.city || geo.region)) || '');
  const region = (geo && geo.region) || '';
  const ip = (geo && geo.ip) || '';
  let data;

  if (WEATHER_KEY) {
    // 和风天气
    const r = await axios.get(`https://devapi.qweather.com/v7/weather/now`, {
      params: { location: '101020100', key: WEATHER_KEY },
      timeout: 5000,
    });
    const now = r.data.now;
    data = {
      city: city || WEATHER_CITY, region, ip,
      text: now.text, temp: now.temp, feelsLike: now.feelsLike,
      humidity: now.humidity, windDir: now.windDir, windScale: now.windScale,
    };
  } else {
    // 免费：wttr.in。city 为空时它会自己按调用方 IP 定位；lang=zh 让天气描述返回中文
    const weatherUrl = city
      ? `https://wttr.in/${encodeURIComponent(city)}?format=j1&lang=zh`
      : 'https://wttr.in/?format=j1&lang=zh';
    const r = await axios.get(weatherUrl, { timeout: 8000 });
    const cur = r.data.current_condition[0];
    const area = r.data.nearest_area && r.data.nearest_area[0];
    data = {
      city: city || (area ? area.areaName[0].value : ''),
      region: region || (area ? area.region[0].value : ''),
      ip,
      text: cur.lang_zh ? cur.lang_zh[0].value : cur.weatherDesc[0].value,
      temp: cur.temp_C, feelsLike: cur.FeelsLikeC, humidity: cur.humidity,
      windDir: cur.winddir16Point, windScale: cur.windspeedKmph,
    };
  }

  // 附上空气质量（用该位置的经纬度，位置不可知时留空）
  const aqi = await fetchAqi(geo && geo.lat, geo && geo.lon);
  if (aqi) Object.assign(data, aqi);

  weatherCacheMap.set(key, { at: Date.now(), data });
  return data;
}

app.get('/api/weather', async (req, res) => {
  try {
    // 按设备分离：带 device 时用该设备的 IP/位置查天气，做到「手机只显示手机的」
    const dev = req.query.device ? DB.devices[req.query.device] : null;
    const geo = dev ? {
      ip: dev.ip,
      city: dev.ipLocation && dev.ipLocation.city,
      region: dev.ipLocation && dev.ipLocation.region,
      lat: dev.ipLat,
      lon: dev.ipLon,
    } : null;
    res.json(await getWeatherData(geo));
  } catch (e) {
    res.status(500).json({ error: '天气获取失败', detail: e.message });
  }
});

// 获取客户端 IP + 粗略位置
app.get('/api/myip', async (req, res) => {
  const ip = getClientIp(req);
  try {
    const r = await axios.get(`https://ipapi.co/${ip}/json/`, { timeout: 5000 });
    res.json({ ip, city: r.data.city, region: r.data.region, country: r.data.country_name });
  } catch {
    res.json({ ip });
  }
});

// ===== AI 对话（provider 抽象：OpenAI 兼容 / 本地 Ollama） =====
// .env: AI_PROVIDER=openai|ollama
//   openai → AI_API_URL / AI_API_KEY / AI_MODEL
//   ollama → OLLAMA_URL / OLLAMA_MODEL（生产环境 Ubuntu Docker 里跑本地模型）
function aiConfigured() {
  if (AI_PROVIDER === 'ollama') return !!OLLAMA_MODEL;
  return !!(AI_API_URL && AI_API_KEY);
}

// ===== AI 人设模板 + 知识库 =====
// 模板：server/ai/prompt.md（可用 AI_PROMPT_FILE 指向别处）
// 知识库：server/ai/knowledge/ 下的 .md / .txt，按文件名排序后注入 system 消息
// 支持占位符：{{date}} {{time}}
const AI_PROMPT_FILE = process.env.AI_PROMPT_FILE || path.join(__dirname, 'ai', 'prompt.md');
const AI_KNOWLEDGE_DIR = process.env.AI_KNOWLEDGE_DIR || path.join(__dirname, 'ai', 'knowledge');
const AI_MAX_KNOWLEDGE_CHARS = parseInt(process.env.AI_MAX_KNOWLEDGE_CHARS || '12000', 10);
// 本地小模型 prompt 处理很慢（CPU 上约 13 tokens/s），不能把整份知识库塞进去，
// 所以按问题做一次关键词检索，只注入最相关的几行。
const AI_RETRIEVE_MAX_CHARS = parseInt(process.env.AI_RETRIEVE_MAX_CHARS || '800', 10);

const DEFAULT_SYSTEM_PROMPT =
  '你是这个站点的博客助手，用简体中文回答。回答简洁、自然、有信息量；不确定的内容如实说明，不要编造。';

function readTextIfExist(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    return '';
  }
}

// 读取知识库目录：单文件内容 + 总长度都有上限，防止把模型上下文撑爆
function loadKnowledge() {
  try {
    if (!fs.existsSync(AI_KNOWLEDGE_DIR)) return '';
    const files = fs.readdirSync(AI_KNOWLEDGE_DIR)
      .filter(f => /\.(md|markdown|txt)$/i.test(f))
      .sort();
    const parts = [];
    let total = 0;
    for (const f of files) {
      const txt = readTextIfExist(path.join(AI_KNOWLEDGE_DIR, f)).trim();
      if (!txt) continue;
      const chunk = `### ${f}\n${txt}`;
      if (total + chunk.length > AI_MAX_KNOWLEDGE_CHARS) {
        parts.push(`（知识库已达 ${AI_MAX_KNOWLEDGE_CHARS} 字符上限，其余文件未加载）`);
        break;
      }
      parts.push(chunk);
      total += chunk.length;
    }
    return parts.join('\n\n');
  } catch (e) {
    console.warn('知识库读取失败:', e.message);
    return '';
  }
}

// 把问题拆成中文二元组 + 英文单词，用于知识库条目打分
function kbTokens(query) {
  const s = String(query || '').toLowerCase();
  const tokens = new Set();
  (s.match(/[a-z0-9_]{2,}/g) || []).forEach(w => tokens.add(w));
  (s.match(/[\u4e00-\u9fa5]{2,}/g) || []).forEach(seg => {
    for (let i = 0; i < seg.length - 1; i++) tokens.add(seg.slice(i, i + 2));
  });
  return [...tokens];
}

// 知识库检索：只挑和问题最相关的几条（标题命中权重更高），避免把整库塞进小模型
function retrieveKnowledge(query) {
  const corpus = loadKnowledge();
  if (!corpus) return '';
  const lines = corpus.split('\n').filter(l => l.trim().startsWith('- '));
  if (!lines.length) return corpus.slice(0, AI_RETRIEVE_MAX_CHARS);
  const tokens = kbTokens(query);
  const scored = lines.map(line => {
    const low = line.toLowerCase();
    const title = ((line.match(/《[^》]*》/) || [''])[0]).toLowerCase();
    let score = 0;
    for (const tk of tokens) {
      if (low.includes(tk)) score += 2;
      if (title.includes(tk)) score += 6;
    }
    return { line, score };
  });
  let picked = scored.filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 5);
  // 没命中关键词（比如「哪篇文章最好看」）时，优先给最近几篇带摘要的，避免只能看到标题
  if (!picked.length) {
    // 摘要行格式：- 《标题》：摘要（索引行是 - 日期 《标题》 链接，不能混进来）
    const withSummary = scored.filter(x => /^- 《[^》]*》：/.test(x.line.trim()));
    picked = withSummary.length ? withSummary.slice(0, 4) : scored.slice(0, 5);
  }
  const out = [];
  let total = 0;
  for (const p of picked) {
    if (total + p.line.length > AI_RETRIEVE_MAX_CHARS) break;
    out.push(p.line);
    total += p.line.length + 1;
  }
  return out.join('\n');
}

// ===== 链接读取：模型自己不能联网，由服务端抓正文再注入 prompt =====
const URL_RE = /https?:\/\/[^\s<>"'）)】，。；]+/gi;

function extractUrls(text) {
  const out = [];
  const s = String(text || '');
  let m;
  const re = new RegExp(URL_RE.source, 'gi');
  while ((m = re.exec(s)) && out.length < 3) {
    out.push(m[0].replace(/[.,;:!?]+$/, ''));
  }
  return out;
}

// 禁止访问本机 / 内网地址，避免被拿来探测内网（SSRF）
function isPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h.includes(':')) {
    if (h === '::1' || h === '::') return true;
    if (/^f[cd]/i.test(h) || /^fe80/i.test(h)) return true;
    return false;
  }
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const a = +m[1], b = +m[2];
  return a === 0 || a === 10 || a === 127
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 100 && b >= 64 && b <= 127);
}

async function assertPublicUrl(raw) {
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('仅支持 http/https');
  if (isPrivateHost(u.hostname)) throw new Error('该地址不允许访问');
  // 域名解析后再校验一次，防止域名指向内网
  if (!u.hostname.startsWith('[')) {
    const addrs = await dns.lookup(u.hostname, { all: true });
    if (!addrs.length || addrs.some(a => isPrivateHost(a.address))) throw new Error('该地址不允许访问');
  }
  return u;
}

const HTML_ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code) => {
    const key = code.toLowerCase();
    if (HTML_ENTITIES[key] != null) return HTML_ENTITIES[key];
    if (key[0] === '#') {
      const n = key[1] === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
      if (Number.isFinite(n)) return String.fromCodePoint(n);
    }
    return m;
  });
}

function htmlToText(html) {
  let s = String(html || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr)[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s.replace(/[ \t\u00a0]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

function extractPageTitle(html) {
  const s = String(html || '');
  const m = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    || s.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  return m ? decodeEntities(m[1]).replace(/\s+/g, ' ').trim() : '';
}

async function fetchPageDigest(rawUrl) {
  const u = await assertPublicUrl(rawUrl);
  const r = await axios.get(u.toString(), {
    timeout: 12000,
    maxContentLength: 3 * 1024 * 1024,
    maxBodyLength: 3 * 1024 * 1024,
    maxRedirects: 2,
    responseType: 'text',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; stalk-bot/1.0)',
      Accept: 'text/html,application/xhtml+xml,text/plain',
    },
    validateStatus: s => s >= 200 && s < 300,
  });
  const type = String((r.headers && r.headers['content-type']) || '');
  if (type && !/text\/html|application\/xhtml|text\/plain|application\/xml/i.test(type)) return null;
  const html = String(r.data || '');
  // 优先只取 <article> 正文，避免抓到一堆导航和页脚
  const main = html.match(/<article[\s\S]*?<\/article>/i);
  const text = htmlToText(main ? main[0] : html).slice(0, AI_URL_MAX_CHARS);
  return text ? { title: extractPageTitle(html), text, url: u.toString() } : null;
}

// 每次请求现读文件，改 prompt.md / 增删知识库后无需重启服务
function buildSystemPrompt(query) {
  let tpl = readTextIfExist(AI_PROMPT_FILE).trim() || DEFAULT_SYSTEM_PROMPT;
  const now = new Date();
  tpl = tpl
    .replace(/\{\{date\}\}/g, now.toLocaleDateString('zh-CN'))
    .replace(/\{\{time\}\}/g, now.toLocaleTimeString('zh-CN'));
  // 寒暄不查知识库，省掉一大段 prompt（这台服务器 CPU 推理很慢）
  const smalltalk = /^(你好|您好|hi|hello|在吗|谢谢|多谢|再见|拜拜)[!！。.？?]*$/i.test(query.trim());
  const kb = smalltalk ? '' : retrieveKnowledge(query);
  if (kb) {
    tpl += '\n\n以下是站点知识库里和这个问题最相关的内容。回答优先依据它们；这里没有的信息就如实说不知道，不要编造。\n\n' + kb;
  }
  return tpl;
}

// 统一入口：传入 OpenAI 风格的 messages，返回助手回复文本
async function chatWithAI(messages) {
  if (AI_PROVIDER === 'ollama') {
    // Ollama 原生 /api/chat（无需 key）
    const r = await axios.post(`${OLLAMA_URL}/api/chat`, {
      model: OLLAMA_MODEL,
      messages,
      stream: false,
      keep_alive: '5m',
      options: {
        num_ctx: OLLAMA_NUM_CTX,
        num_thread: OLLAMA_NUM_THREAD,
        num_predict: OLLAMA_NUM_PREDICT,
        temperature: 0.4,
      },
    }, { timeout: 120000 });
    return (r.data && r.data.message && r.data.message.content) || '';
  }
  // OpenAI 兼容
  const r = await axios.post(AI_API_URL, {
    model: AI_MODEL,
    messages,
    stream: false,
  }, {
    headers: { Authorization: `Bearer ${AI_API_KEY}`, 'Content-Type': 'application/json' },
    timeout: 60000,
  });
  return r.data.choices[0].message.content;
}

// 同一时间只允许一个生成任务：2 核机器并发推理会互相抢 CPU，全部变慢
let aiBusy = false;

// POST /api/ai { message, history: [{role, content}] }
app.post('/api/ai', aiRateLimit, async (req, res) => {
  const { message, history } = req.body || {};
  if (!message || typeof message !== 'string') return res.status(400).json({ error: '缺少 message' });
  if (message.length > 2000) return res.status(400).json({ error: '消息过长，请控制在 2000 字以内' });
  if (isUnsafeContent(message)) return res.status(400).json({ error: '内容包含不当信息，已被拦截' });
  if (!aiConfigured()) {
    return res.json({ reply: 'AI 未配置。请在 .env 中设置 AI_PROVIDER（openai / ollama）及对应的 URL、KEY、MODEL。' });
  }
  // 带链接：服务端抓正文直接返回摘要（CPU 跑长文总结太慢，会拖垮整机）
  const link = extractUrls(message)[0];
  if (link) {
    let page = null;
    try {
      page = await fetchPageDigest(link);
    } catch (e) {
      console.warn('链接抓取失败:', link, e.message);
    }
    if (page) {
      const title = page.title ? `《${page.title}》\n\n` : '';
      return res.json({
        reply: `${title}我从链接里读到的正文：\n\n${page.text.slice(0, 700)}……\n\n完整内容可以打开原文：${link}`,
      });
    }
    return res.json({ reply: '这个链接我没能读到正文，可能被反爬、需要登录，或者不是网页。' });
  }
  // 本地 Ollama 在 2 核机器上同时只能跑一个；云端 API 可以并发，不做限制
  if (AI_PROVIDER === 'ollama' && aiBusy) {
    return res.json({ reply: '前面还有人正在问，我一次只能想一件事，稍等十几秒再问一次就好。' });
  }
  aiBusy = true;
  try {
    const msgs = [{ role: 'system', content: buildSystemPrompt(message) }]
      .concat(Array.isArray(history) ? history.slice(-6) : [])
      .concat([{ role: 'user', content: message }]);
    const reply = (await chatWithAI(msgs) || '').trim();
    res.json({ reply: reply || '我想了半天没组织好，换个说法再问我一次？' });
  } catch (e) {
    console.warn('AI 生成失败:', e.message);
    // 模型超时/出错时也回 200，前端能正常展示提示，而不是像没反应
    res.json({ reply: '抱歉，服务器这会儿有点忙，没能及时生成回答。可以换个短一点的问题，或者直接发文章链接给我。' });
  } finally {
    aiBusy = false;
  }
});

// ========== Socket.IO 实时通信 ==========
// 在线观看人数 = 当前命名空间里真实连接的 socket 数（实时并发）。
// 不要用 io.engine.clientsCount：它统计 engine.io 层连接，
// 在 disconnect 回调里往往还没把自己减掉，导致数字只增不减，
// 看起来就像"总访问次数"而不是实时人数。
function currentViewers() {
  return io.of('/').sockets.size;
}

// 延后一个 tick 再广播，确保 socket 已完成加入 / 移出
function broadcastViewers() {
  setImmediate(() => {
    const n = currentViewers();
    io.emit('viewerCountUpdate', n);
    console.log(`观看人数: ${n}`);
  });
}

io.on('connection', (socket) => {
  const n = currentViewers();
  console.log(`新连接，当前观看人数: ${n}`);
  broadcastViewers();

  // 初始化：把当前状态发给新连接
  socket.emit('init', {
    devices: DB.devices,
    activity: DB.activityStream.slice(-50),
    currentActivity: DB.currentActivity,
    chat: DB.chat.slice(-50),
    music: DB.music,
    location: DB.location,
    viewerCount: n,
  });

  // Socket.IO 方式发聊天（单连接限流 + 敏感词过滤）
  let chatHits = [];
  socket.on('chatMessage', (msg) => {
    msg = msg || {};
    const now = Date.now();
    chatHits = chatHits.filter(t => now - t < 60000);
    if (chatHits.length >= 15) return; // 单连接每分钟最多 15 条
    const nickname = String(msg.nickname || '访客').slice(0, 20);
    const message = String(msg.message || '').slice(0, 500);
    if (!message.trim()) return;
    if (isUnsafeContent(message) || isUnsafeContent(nickname)) return;
    chatHits.push(now);
    const entry = {
      id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      nickname,
      message,
      timestamp: Date.now(),
      deviceId: msg.deviceId || null,
    };
    DB.chat.push(entry);
    pruneOld();
    saveData('chat');
    io.emit('chatUpdate', { type: 'new', data: entry });
  });

  socket.on('disconnect', () => {
    broadcastViewers();
  });
});

// ========== 启动 ==========
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  👁️  stalk 启动成功`);
  console.log(`  后端:   http://localhost:${PORT}`);
  console.log(`  前端:   http://localhost:${PORT}  (同端口，SPA)`);
  console.log(`  密钥:   ${SECRET_KEY}`);
  console.log(`\n  设备上报示例 (PowerShell):`);
  console.log(`  curl -X POST http://localhost:${PORT}/api/heartbeat -H "X-Auth-Key: ${SECRET_KEY}" -H "Content-Type: application/json" -d '{\"deviceId\":\"pc1\",\"deviceName\":\"我的电脑\",\"deviceType\":\"computer\",\"appName\":\"VS Code\"}'`);
  console.log(`\n  Socket.IO 事件:`);
  console.log(`    activityStreamUpdate, deviceStatusUpdate, chatUpdate, viewerCountUpdate`);
});
