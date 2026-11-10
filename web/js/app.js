// 先摘掉启动占位层（包在 finally 里做了，这里只声明）
function hideBoot() {
  const b = document.getElementById('boot');
  if (b) b.style.display = 'none';
}
// Vue 没加载出来时（断网 / CDN 被墙），占位层给出提示，而不是裸奔的 {{ }}
if (!window.Vue) {
  const b = document.getElementById('boot');
  if (b) b.innerHTML = '<div style="text-align:center;line-height:1.9;font-size:15px">⚠️ 页面资源加载失败<br><span style="color:#8a9aaf">请检查网络后刷新页面</span></div>';
  throw new Error('Vue 未加载');
}
const { createApp, ref, computed, onMounted, onUnmounted, nextTick, watch } = Vue;

const SERVER = location.origin;
const socket = io(SERVER, { transports: ['websocket', 'polling'] });

createApp({
  setup() {
    // ====== 国际化（默认跟随浏览器语言，可手动在 中/EN/FR 之间切换）======
    const LANGS = ['zh', 'en', 'fr'];
    const lang = ref(document.documentElement.getAttribute('data-lang') || 'zh');

    function t(key) {
      const dict = I18N[lang.value] || I18N.zh;
      return dict[key] != null ? dict[key] : (I18N.zh[key] || key);
    }
    // 带占位符的翻译：tpl('active.heatmapTitle', { n: 126 })
    function tpl(key, vars) {
      return t(key).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    }
    function toggleLang() {
      const i = LANGS.indexOf(lang.value);
      lang.value = LANGS[(i + 1) % LANGS.length];
      document.documentElement.setAttribute('lang', lang.value);
      document.documentElement.setAttribute('data-lang', lang.value);
      applyDocTitle();
      try { localStorage.setItem('wt-lang', lang.value); } catch (e) {}
    }
    // 页面标题跟随语言（effects.js 的标签页提示也用这个标题）
    function applyDocTitle() {
      const title = t('app.docTitle');
      document.title = title;
      document.documentElement.setAttribute('data-doc-title', title);
    }
    applyDocTitle();
    // ====== 状态 ======
    const devices = ref({});
    const activityStream = ref([]);
    const currentActivity = ref({});
    const chat = ref([]);
    const viewerCount = ref(0);
    const weather = ref({});
    const showInteractive = ref(true);
    const selectedDevice = ref('');
    const showDeviceDrawer = ref(false);   // 手机端左上角设备抽屉是否展开
    // 左上角抽屉按钮的引导提示：首次访问显示，用户点过按钮后永久记住不再弹
    const showDrawerHint = ref((() => {
      try { return localStorage.getItem('stalk-drawer-hint') !== '1'; } catch (e) { return true; }
    })());
    function dismissDrawerHint() {
      showDrawerHint.value = false;
      try { localStorage.setItem('stalk-drawer-hint', '1'); } catch (e) {}
    }
    // 用户一旦点开抽屉，就视为已学会，自动收起提示并记住
    watch(showDeviceDrawer, (v) => { if (v) dismissDrawerHint(); });
    function selectDevice(id) {
      selectedDevice.value = id;
      showDeviceDrawer.value = false;      // 手机端选中设备后自动收起抽屉
    }
    const myNickname = ref((() => {
      try { return localStorage.getItem('stalk-nickname') || null; } catch (e) { return null; }
    })() || t('chat.guest') + Math.floor(Math.random()*900+100));
    // 昵称持久化：刷新/下次访问还是同一个人
    try { localStorage.setItem('stalk-nickname', myNickname.value); } catch (e) {}
    const chatDraft = ref('');
    const chatUnread = ref(0);       // 未读消息数（红点）
    const toasts = ref([]);          // 右下角弹窗队列
    let toastSeq = 0;
    // AI 对话历史：从 localStorage 恢复，最多保留最近 50 条
    const aiHistory = ref((() => {
      try {
        const saved = JSON.parse(localStorage.getItem('stalk-ai-history') || '[]');
        return Array.isArray(saved) ? saved : [];
      } catch (e) { return []; }
    })());
    function persistAiHistory() {
      try { localStorage.setItem('stalk-ai-history', JSON.stringify(aiHistory.value.slice(-50))); } catch (e) {}
    }
    watch(aiHistory, persistAiHistory, { deep: true });
    const aiDraft = ref('');
    const aiLoading = ref(false);
    const chatList = ref(null);
    const aiList = ref(null);
    // 右下角客服式浮窗：聊天室 / AI 对话
    const fabOpen = ref(false);
    const fab = ref('chat');
    function toggleFab(kind) {
      if (fabOpen.value && fab.value === kind) fabOpen.value = false;
      else { fab.value = kind; fabOpen.value = true; }
      // 打开聊天室时清掉未读红点
      if (kind === 'chat' && fabOpen.value) chatUnread.value = 0;
    }

    // ====== 新消息弹窗（Windows 右下角风格）======
    function showChatToast(msg) {
      const id = ++toastSeq;
      toasts.value.push({ id, nickname: msg.nickname, message: msg.message });
      // 最多保留 3 条，多了把最旧的挤掉
      if (toasts.value.length > 3) toasts.value.shift();
      // 5 秒后自动消失
      setTimeout(() => dismissToast(id), 5000);
    }
    function dismissToast(id) {
      const i = toasts.value.findIndex(t => t.id === id);
      if (i !== -1) toasts.value.splice(i, 1);
    }
    function openChatFromToast() {
      fab.value = 'chat';
      fabOpen.value = true;
      chatUnread.value = 0;
    }
    // 关闭在线互动时，若浮窗正停在聊天室，自动收起
    watch(showInteractive, v => { if (!v && fab.value === 'chat') fabOpen.value = false; });
    // 今日总结 + AI 智能总结
    const summary = ref({ openedApps: 0, totalSeconds: 0, mostUsed: null, perApp: [], hourly: new Array(24).fill(0) });
    const heatmap = ref({ days: 126, weeks: [], max: 0 }); // GitHub 风格贡献墙（列=周，行=星期）
    const insights = ref([]);
    const aiText = ref('');
    const insightsLoading = ref(false);
    // 深色模式：初始值来自 head 里的预置脚本
    const dark = ref(document.documentElement.classList.contains('dark'));
    // 主题模式：只有 light | dark（已移除「跟随系统」）
    const themeMode = ref(document.documentElement.getAttribute('data-theme-mode') === 'dark' ? 'dark' : 'light');
    let themeTimer; // 主题过渡计时器：动画结束后移除 theme-anim
    function applyTheme(mode) {
      const root = document.documentElement;
      const isDark = mode === 'dark';
      root.classList.add('theme-anim');
      dark.value = isDark;
      root.classList.toggle('dark', isDark);
      root.setAttribute('data-theme-mode', mode);
      clearTimeout(themeTimer);
      themeTimer = setTimeout(() => root.classList.remove('theme-anim'), 480);
    }
    function toggleTheme() {
      const next = themeMode.value === 'dark' ? 'light' : 'dark';
      themeMode.value = next;
      try { localStorage.setItem('wt-theme-mode', next); } catch (e) {}
      applyTheme(next);
    }
    // 页面路由：'home' 首页 | 'app' 监控面板
    // 用 URL hash 驱动（#/ 与 #/app），是两个真正的页面：
    //   - 刷新 / 首次进入一律回到首页（不持久化已进入状态）
    //   - 浏览器前进/后退键可在两页之间来回切换
    const route = ref('home');
    function setRoute(r, push) {
      route.value = r;
      const h = r === 'app' ? '#/app' : '#/';
      if (push) { if (location.hash !== h) location.hash = h; }
      else history.replaceState(null, '', h);
    }
    function enterDashboard() { setRoute('app', true); }
    function onHashChange() { route.value = (location.hash === '#/app') ? 'app' : 'home'; }

    // 首页背景视差：鼠标移动时轻微平移背景层（幅度小、带 rAF 节流）
    const parallax = ref({ x: 0, y: 0 });
    const bgParallaxStyle = computed(() => ({ transform: `translate(${parallax.value.x}%, ${parallax.value.y}%)` }));
    let parallaxRAF = null;
    function onLandingMouseMove(e) {
      if (parallaxRAF) return;
      parallaxRAF = requestAnimationFrame(() => {
        const x = (e.clientX / window.innerWidth - 0.5) * 8;
        const y = (e.clientY / window.innerHeight - 0.5) * 8;
        parallax.value = { x: -x, y: -y };
        parallaxRAF = null;
      });
    }
    // 首页状态卡：应用变化时闪一下，以及用于每秒刷新的 tick
    const landingChanged = ref(false);
    let landingTimer;
    const tick = ref(0);
    // 首页「看起来没逝，xxxx」—— 随机一句小总结，每次进首页随机一条（按当前语言取）
    let moodIdx = Math.floor(Math.random() * 20);
    const landingMood = computed(() => t('mood.list').split('|')[moodIdx] || '');

    // 洞察归属板块：按 tag 把洞察拆进对应卡片，未命中归到监听流
    const INSIGHT_PANEL = {
      '应用': 'rank', '音乐': 'rank',
      '专注': 'current', '设备': 'current',
      '天气': 'weather', '空气': 'weather',
      '作息': 'summary',
    };
    function panelInsights(panel) {
      return insights.value.filter(i => (INSIGHT_PANEL[i.tag] || 'stream') === panel);
    }

    // ====== 计算属性 ======
    const sortedDevices = computed(() => {
      const arr = Object.entries(devices.value).map(([id, d]) => ({ ...d, _id: id }));
      arr.sort((a, b) => (b.online - a.online) || (b.lastSeen - a.lastSeen));
      return arr;
    });

    const onlineCount = computed(() => sortedDevices.value.filter(d => d.online).length);

    const todayStr = computed(() => {
      const d = new Date();
      return `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
    });

    // ====== 监听流历史日期浏览（◀ 前一天 / ▶ 后一天 / 📅 选日期）======
    function pad2(n) { return String(n).padStart(2, '0'); }
    function dateKeyOf(d) { return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }
    const todayKey = computed(() => dateKeyOf(new Date()));
    const streamDate = ref(dateKeyOf(new Date())); // 当前查看的日期，默认今天
    const dayHistory = ref([]);                     // 历史日期从服务端拉取的活动记录
    const dateInput = ref(null);
    const hourlyChartEl = ref(null);   // ApexCharts 容器
    let hourlyChart = null;            // ApexCharts 实例
    const isToday = computed(() => streamDate.value === todayKey.value);
    const canGoNext = computed(() => streamDate.value < todayKey.value);
    const streamDateLabel = computed(() => {
      const [y, m, d] = streamDate.value.split('-');
      return `${y}/${m}/${d}`;
    });
    function shiftDate(delta) {
      const [y, m, d] = streamDate.value.split('-').map(Number);
      streamDate.value = dateKeyOf(new Date(y, m - 1, d + delta));
    }
    async function loadDayActivity() {
      try {
        const r = await fetch(`${SERVER}/api/activity?date=${streamDate.value}&limit=300`);
        dayHistory.value = await r.json();
      } catch (e) { console.warn('历史活动加载失败', e); }
    }
    watch(streamDate, (v) => { if (v !== todayKey.value) loadDayActivity(); });
    function openDatePicker() {
      const el = dateInput.value;
      if (!el) return;
      if (typeof el.showPicker === 'function') { try { el.showPicker(); return; } catch (e) {} }
      el.focus(); el.click();
    }
    function onPickDate(e) { if (e.target.value) streamDate.value = e.target.value; }

    // 活跃时段分布图：ApexCharts 渐变面积图（来自 sample/图表）
    // 等 ApexCharts 脚本加载完再渲染；CDN 慢时轮询重试，避免图表一直空白
    function ensureApex(cb, attempt) {
      attempt = attempt || 0;
      if (typeof ApexCharts !== 'undefined') { cb(); return; }
      if (attempt > 80) return; // 最多等 40 秒
      setTimeout(() => ensureApex(cb, attempt + 1), 500);
    }
    function renderHourlyChart() {
      if (!hourlyChartEl.value) return;
      ensureApex(() => {
        if (!hourlyChartEl.value) return;
        const hours = (summary.value.hourly || new Array(24).fill(0)).slice(0, 24);
        const categories = hours.map((_, i) => String(i).padStart(2, '0') + ':00');
        const values = hours.map(s => Math.round(s / 60)); // 秒 → 分钟
        const gridColor = dark.value ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
        const labelColor = dark.value ? '#8aa0b8' : '#94a3b8';
        const options = {
          chart: { type: 'area', height: 200, toolbar: { show: false }, zoom: { enabled: false },
            fontFamily: 'inherit', background: 'transparent', animations: { enabled: true, easing: 'easeout', speed: 600 } },
          series: [{ name: t('chart.usage'), data: values }],
          stroke: { curve: 'smooth', width: 3 },
          fill: {
            type: 'gradient',
            gradient: { shadeIntensity: 1, opacityFrom: 0.55, opacityTo: 0.05, stops: [0, 90, 100],
              colorStops: [{ offset: 0, color: '#ec4899', opacity: 0.55 }, { offset: 100, color: '#f9a8d4', opacity: 0.05 }] }
          },
          dataLabels: { enabled: false },
          xaxis: { categories, labels: { style: { colors: labelColor, fontSize: '10px' } }, axisBorder: { show: false }, axisTicks: { show: false } },
          yaxis: { labels: { style: { colors: labelColor, fontSize: '10px' } }, tooltip: { enabled: false } },
          grid: { borderColor: gridColor, strokeDashArray: 3, padding: { left: 0, right: 0 } },
          tooltip: { theme: dark.value ? 'dark' : 'light',
            y: { formatter: (v) => v + ' ' + t('chart.minutes') } },
          colors: ['#ec4899'],
        };
        if (hourlyChart) {
          hourlyChart.updateOptions(options, false, true);
          hourlyChart.updateSeries(options.series);
        } else {
          hourlyChart = new ApexCharts(hourlyChartEl.value, options);
          hourlyChart.render();
        }
      });
    }
    // 数据 / 主题 / 语言变化时重绘图表
    watch(() => summary.value.hourly, renderHourlyChart, { deep: true });
    watch([dark, lang], renderHourlyChart);
    onMounted(() => nextTick(renderHourlyChart));

    // 是否移动端布局：与 CSS 断点保持一致（<= 768px 视为手机/窄屏）
    const isMobile = ref(window.innerWidth <= 768);
    const onResizeMobile = () => { isMobile.value = window.innerWidth <= 768; };
    window.addEventListener('resize', onResizeMobile);
    onUnmounted(() => window.removeEventListener('resize', onResizeMobile));

    // 桌面端：Live Stream 卡片高度跟随右列（天气 + 今日排行），
    // 否则记录一多就会把整列越撑越长，下沿也对不齐。
    let streamSyncRO = null;
    let streamSyncResize = null;
    function clearStreamHeight() {
      const card = document.querySelector('.main-grid > div:first-child > .card');
      if (card) card.style.height = '';
    }
    function destroyStreamSync() {
      if (streamSyncRO) { streamSyncRO.disconnect(); streamSyncRO = null; }
      if (streamSyncResize) { window.removeEventListener('resize', streamSyncResize); streamSyncResize = null; }
      clearStreamHeight();
    }
    function setupStreamSync() {
      destroyStreamSync();
      const grid = document.querySelector('.main-grid');
      const right = grid && grid.children[1];
      const card = grid && grid.children[0] && grid.children[0].querySelector(':scope > .card');
      if (!right || !card) return;
      const apply = () => {
        // <=950px 时改为上下排列，不需要限高
        if (window.innerWidth <= 950) { card.style.height = ''; return; }
        const h = right.offsetHeight;
        if (h > 0) card.style.height = h + 'px';
      };
      apply();
      window.addEventListener('resize', apply);
      streamSyncResize = apply;
      if (typeof ResizeObserver !== 'undefined') {
        streamSyncRO = new ResizeObserver(apply);
        streamSyncRO.observe(right);
      }
    }
    // flush:'post' 保证 DOM 已经渲染出 .main-grid 再测量高度
    watch(route, (r) => {
      if (r === 'app') setupStreamSync();
      else destroyStreamSync();
    }, { flush: 'post' });

    const filteredActivity = computed(() => {
      // 今天用实时流（socket 即时更新），历史日期用服务端按天拉取的记录
      const base = isToday.value ? activityStream.value : dayHistory.value;
      const list = (selectedDevice.value && selectedDevice.value !== '总览')
        ? base.filter(a => a.deviceId === selectedDevice.value)
        : base;
      // 倒序：最新的排在最上面。用 slice() 先复制再 reverse，
      // 避免就地改动 activityStream
      const rev = list.slice().reverse();
      // 移动端只展示最近 6 条：列表太长会把页面撑得拖不到底
      return isMobile.value ? rev.slice(0, 6) : rev;
    });

    const selectedDeviceInfo = computed(() => devices.value[selectedDevice.value] || null);

    // 活跃时段分布图：今日 24 小时里使用最久的一小时，作为柱状图的 100% 高度
    const hourlyMax = computed(() => Math.max(0, ...(summary.value.hourly || [])));

    // GitHub 贡献墙：行 = 星期（日→六），列 = 周（由后端按周切分好）
    const ghWeekdays = computed(() => [0, 1, 2, 3, 4, 5, 6].map(i => t('week.' + i)));
    // 把 weeks（若干周，每周 7 天）按列优先顺序摊平成 CSS grid 需要的数组
    const heatmapCells = computed(() => {
      const out = [];
      (heatmap.value.weeks || []).forEach(w => {
        for (let d = 0; d < 7; d++) out.push(w[d] || null);
      });
      return out;
    });
    // 月份标签：只在某一周的第一天跨月时显示，其余留空
    const heatmapMonths = computed(() => {
      const weeks = heatmap.value.weeks || [];
      const labels = [];
      let last = -1;
      weeks.forEach(w => {
        const first = w.find(c => c);
        let label = '';
        if (first) {
          const m = new Date(first.date).getMonth();
          if (m !== last) { label = (m + 1) + t('chart.month'); last = m; }
        }
        labels.push(label);
      });
      return labels;
    });

    // 首页状态卡：取第一个在线设备（无在线则取任意设备）
    const landingDevice = computed(() => sortedDevices.value.find(d => d.online) || sortedDevices.value[0] || null);
    const ownerName = computed(() => (landingDevice.value && landingDevice.value.name) || t('landing.ownerFallback'));
    const landingAppText = computed(() => {
      const d = landingDevice.value;
      if (!d) return t('landing.waiting');
      if (!d.online) return t('landing.offline');
      // Pad/手机熄屏时，首页状态卡优先展示「熄屏」
      if (d.screenOff) return t('landing.locked');
      // 桌面长时间无操作 → 挂机（服务端标记 idle）
      if (d.idle) return '💤 ' + t('device.idle');
      if (d.currentDetail) return d.currentDetail;
      return doingText(d.currentApp, d.activityPhrase) || t('landing.unknown');
    });
    const landingTime = computed(() => {
      void tick.value; // 依赖 tick，每秒刷新
      let t = 0;
      for (const d of Object.values(devices.value)) if (d.lastSeen > t) t = d.lastSeen;
      if (!t) return '--:--:--';
      const dt = new Date(t);
      return [dt.getHours(), dt.getMinutes(), dt.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
    });
    watch(landingAppText, () => {
      landingChanged.value = true;
      clearTimeout(landingTimer);
      landingTimer = setTimeout(() => { landingChanged.value = false; }, 1000);
    });

    const currentActivityList = computed(() => {
      const now = Date.now();
      const list = [];
      for (const [id, cur] of Object.entries(currentActivity.value)) {
        if (selectedDevice.value && id !== selectedDevice.value) continue; // 只看选中设备
        const dev = devices.value[id];
        // 熄屏中的设备不展示「正在使用」，即使 currentActivity 残留也隐藏
        if (dev && dev.online && !dev.screenOff) {
          list.push({
            device: dev,
            currentApp: cur.appName,
            activityPhrase: cur.activityPhrase || dev.activityPhrase || '',
            detail: cur.detail || dev.currentDetail || '',
            duration: Math.floor((now - cur.startTime) / 1000),
          });
        }
      }
      list.sort((a, b) => b.duration - a.duration);
      return list;
    });

    const currentDoing = computed(() => {
      const items = currentActivityList.value;
      if (items.length === 0) return t('landing.resting');
      return items.map(i => doingText(i.currentApp, i.activityPhrase)).join(' · ');
    });

    // ====== 居中可爱面板：顶部时钟 / 日期块 / 此刻表情 ======
    const clockText = computed(() => {
      void tick.value;
      const d = new Date();
      return [d.getHours(), d.getMinutes()].map(n => String(n).padStart(2, '0')).join(':');
    });
    const streamDateMeta = computed(() => {
      const [y, m, d] = streamDate.value.split('-').map(Number);
      const dt = new Date(y, m - 1, d);
      const MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
      const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
      return { mon: MON[dt.getMonth()], day: dt.getDate(), wd: WD[dt.getDay()] };
    });
    const nowEmoji = computed(() => (currentActivityList.value.length ? '(・∀・)ﾉ' : '( -.-)zzZ'));
    function scrollToPanel(id) {
      const el = document.getElementById('panel-' + id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ====== 工具 ======
    // 「熄屏」文本统一：把历史数据/各端上报的多种写法（已息屏、熄屏、off…）归一，
    // 保证状态框文案与设备卡片角标「熄屏」一致
    function screenStateText(s) {
      if (!s) return s;
      if (/息屏|熄屏|锁屏|locked|关屏|黑屏|off/i.test(s)) return t('device.screenoff');
      if (/亮屏|unlock|screen on|^on$/i.test(s)) return t('device.screenon');
      return s;
    }
    function deviceIcon(type) {
      if (type === 'computer') return '💻';
      // AutoTask 上报的移动端 type 是 android，这里和 phone 一并按手机展示
      if (type === 'phone' || type === 'android') return '📱';
      if (type === 'pad') return '📱';
      return '📟';
    }

    function formatTime(ts) {
      if (!ts) return '';
      const d = new Date(ts);
      return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
    }

    function formatDuration(sec) {
      sec = Math.floor(sec);
      if (sec < 60) return sec + t('dur.sec');
      if (sec < 3600) return Math.floor(sec/60) + t('dur.min') + (sec%60 ? ' ' + sec%60 + t('dur.sec') : '');
      const h = Math.floor(sec/3600);
      const m = Math.floor((sec%3600)/60);
      return h + t('dur.hour') + (m ? ' ' + m + t('dur.min') : '');
    }

    function timeAgo(ts) {
      if (!ts) return '';
      const diff = Math.floor((Date.now() - ts) / 1000);
      if (diff < 10) return t('time.justNow');
      if (diff < 60) return diff + t('time.secAgo');
      if (diff < 3600) return Math.floor(diff/60) + t('time.minAgo');
      if (diff < 86400) return Math.floor(diff/3600) + t('time.hourAgo');
      return Math.floor(diff/86400) + t('time.dayAgo');
    }

    // ====== 展示文案 ======
    // 把「应用名 + 语气短语」拼成一句话，例如「正在使用 Edge 浏览器 冲浪」
    function doingText(appName, phrase) {
      if (!appName) return t('state.standby');
      // 锁屏 / 熄屏这类特殊状态直接展示，不加「正在使用」前缀
      if (appName.indexOf('🔒') === 0) return appName;
      return t('state.using') + appName + (phrase ? ' ' + phrase : '');
    }

    // 设备位置：局域网设备显示「局域网 · 城市」，公网设备直接显示城市
    function locText(dev) {
      if (!dev || !dev.ipLocation) return '';
      const city = dev.ipLocation.city || dev.ipLocation.region || '';
      if (!city) return '';
      return (dev.ipType === 'lan' ? 'LAN · ' : '') + city;
    }

    // ====== 聊天 ======
    function sendChat() {
      const msg = chatDraft.value.trim();
      if (!msg) return;
      socket.emit('chatMessage', { nickname: myNickname.value, message: msg });
      chatDraft.value = '';
    }

    function scrollChat() {
      nextTick(() => {
        if (chatList.value) chatList.value.scrollTop = chatList.value.scrollHeight;
      });
    }

    // ====== AI ======
    async function sendAi() {
      const msg = aiDraft.value.trim();
      if (!msg || aiLoading.value) return;
      aiHistory.value.push({ role: 'user', content: msg });
      aiDraft.value = '';
      aiLoading.value = true;
      try {
        // 加上超时：服务器被占满时不会一直转圈，超时后给出明确提示
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 110000);
        let data = {};
        try {
          const r = await fetch(SERVER + '/api/ai', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg, history: aiHistory.value.slice(-6) }),
            signal: ctrl.signal,
          });
          data = await r.json().catch(() => ({}));
        } finally {
          clearTimeout(timer);
        }
        // 服务端限流 / 内容拦截返回的是 { error }，也要显示出来，
        // 否则前端只会拿到“no reply”，让人以为 AI 挂了
        aiHistory.value.push({
          role: 'assistant',
          content: data.reply || data.error || t('ai.noReply'),
        });
      } catch (e) {
        const msgText = e.name === 'AbortError' ? t('ai.timeout') : (t('ai.fail') + e.message);
        aiHistory.value.push({ role: 'assistant', content: msgText });
      }
      aiLoading.value = false;
      nextTick(() => { if (aiList.value) aiList.value.scrollTop = aiList.value.scrollHeight; });
    }

    // ====== 初始化 ======
    // 按设备分离：带上 device 参数时，天气/总结/热力墙只取该设备的数据
    // 用序号丢弃过期响应：切设备时会先后发出两个请求，避免旧请求后到达把新数据覆盖掉
    function deviceQuery(sep) {
      const d = selectedDevice.value;
      return d ? (sep + 'device=' + encodeURIComponent(d)) : '';
    }
    let weatherSeq = 0, summarySeq = 0, heatmapSeq = 0;

    async function loadWeather() {
      const seq = ++weatherSeq;
      try {
        const d = await fetch(SERVER + '/api/weather' + deviceQuery('?')).then(r => r.json());
        if (seq === weatherSeq) weather.value = d;
      } catch (e) { console.warn('天气加载失败', e); }
    }

    // 今日总结
    async function loadSummary() {
      const seq = ++summarySeq;
      try {
        const d = await fetch(SERVER + '/api/summary/today' + deviceQuery('?')).then(r => r.json());
        if (seq === summarySeq && !d.error) summary.value = d;
      } catch (e) { console.warn('今日总结加载失败', e); }
    }

    // 活跃时段热力墙：GitHub 风格贡献墙，最近 N 天（按周聚合）
    async function loadHeatmap() {
      const seq = ++heatmapSeq;
      try {
        const d = await fetch(SERVER + '/api/summary/heatmap?days=126' + deviceQuery('&')).then(r => r.json());
        if (seq === heatmapSeq && !d.error) heatmap.value = d;
      } catch (e) { console.warn('热力墙加载失败', e); }
    }

    // AI 智能总结；withAi 为 true 时额外让大模型说一段话
    let insightsSeq = 0;
    async function loadInsights(withAi) {
      const seq = ++insightsSeq;
      insightsLoading.value = true;
      try {
        // 洞察同样按设备分离：带上当前选中设备
        const params = [];
        if (selectedDevice.value) params.push('device=' + encodeURIComponent(selectedDevice.value));
        if (withAi) params.push('ai=1');
        const r = await fetch(SERVER + '/api/insights' + (params.length ? '?' + params.join('&') : ''));
        const d = await r.json();
        if (seq !== insightsSeq) return; // 丢弃过期响应，避免切设备时旧数据覆盖
        insights.value = d.insights || [];
        aiText.value = d.aiText || '';
      } catch (e) {
        console.warn('AI 智能总结加载失败', e);
      } finally {
        if (seq === insightsSeq) insightsLoading.value = false;
      }
    }

    // 排行条宽度：以榜首为 100%，最小 4% 避免不可见
    function rankPct(sec) {
      const list = summary.value.perApp || [];
      const max = list.length ? list[0].seconds : 0;
      return Math.max(4, Math.round((sec / (max || 1)) * 100)) + '%';
    }

    // 热力墙单元格颜色：GitHub 风格 5 档（越活跃越绿）
    function heatmapColor(sec, max) {
      if (!sec || sec <= 0) return 'var(--hm-0)';
      const r = sec / (max || 1);
      if (r < 0.15) return 'var(--hm-1)';
      if (r < 0.35) return 'var(--hm-2)';
      if (r < 0.65) return 'var(--hm-3)';
      return 'var(--hm-4)';
    }
    function heatmapDayLabel(ts) {
      const d = new Date(ts);
      return (d.getMonth() + 1) + '/' + d.getDate();
    }

    let refreshTimer;
    let summaryTimer;
    let insightsTimer;
    let heatmapTimer;

    onMounted(() => {
      // 规范化 URL：无论刷新前停在哪个页面，都回到首页（不新增历史记录）
      history.replaceState(null, '', '#/');
      route.value = 'home';
      window.addEventListener('hashchange', onHashChange);

      // Socket.IO 事件
      socket.on('init', (data) => {
        devices.value = data.devices || {};
        activityStream.value = data.activity || [];
        currentActivity.value = data.currentActivity || {};
        chat.value = data.chat || [];
        viewerCount.value = data.viewerCount || 0;
        scrollChat();
      });

      socket.on('deviceStatusUpdate', (d) => {
        devices.value = d;
      });

      socket.on('activityStreamUpdate', (payload) => {
        if (payload.type === 'new') {
          activityStream.value.push(payload.data);
          // 结束上一个同设备同类型
          const id = payload.data.deviceId;
          const prev = activityStream.value.find(a => a.deviceId === id && a.endTime === null && a.id !== payload.data.id);
          if (prev) {
            prev.endTime = payload.data.startTime;
            prev.duration = Math.floor((prev.endTime - prev.startTime) / 1000);
          }
          // 更新 currentActivity
          if (payload.data.endTime === null) {
            currentActivity.value[id] = {
              appName: payload.data.appName,
              activityPhrase: payload.data.activityPhrase || '',
              detail: payload.data.detail || '',
              startTime: payload.data.startTime,
            };
          }
        } else if (payload.type === 'detail') {
          // 同一应用内内容变化（如切歌 / 换视频）：就地更新，不新增条目
          const { deviceId, detail } = payload.data;
          const act = activityStream.value.find(a => a.deviceId === deviceId && a.endTime === null);
          if (act) act.detail = detail;
          if (currentActivity.value[deviceId]) currentActivity.value[deviceId].detail = detail;
        }
      });

      socket.on('chatUpdate', (payload) => {
        if (payload.type === 'new') {
          chat.value.push(payload.data);
          scrollChat();
          // 不是自己发的、且聊天室面板没打开 → 红点 + 右下角弹窗
          const msg = payload.data;
          const chatVisible = fabOpen.value && fab.value === 'chat';
          if (msg.nickname !== myNickname.value && !chatVisible) {
            chatUnread.value++;
            showChatToast(msg);
          }
        }
      });

      socket.on('viewerCountUpdate', (n) => { viewerCount.value = n; });

      // 轮询天气（每5分钟）
      refreshTimer = setInterval(loadWeather, 5 * 60 * 1000);

      // 今日总结（每 30 秒）/ 洞察（每 60 秒）
      // 先拉天气再拉洞察：服务端天气有 10 分钟缓存，等它预热完，首屏才会带上天气/空气类洞察
      loadWeather().then(() => loadInsights(false));
      loadSummary();
      loadHeatmap();
      summaryTimer = setInterval(loadSummary, 30 * 1000);
      insightsTimer = setInterval(() => { if (!insightsLoading.value) loadInsights(false); }, 60 * 1000);
      heatmapTimer = setInterval(loadHeatmap, 5 * 60 * 1000);

      // 在线观看人数：socket 实时推送 + 每 10 秒轮询兜底，避免漏更新
      const loadViewers = async () => {
        try {
          const d = await fetch(SERVER + '/api/viewers').then(r => r.json());
          if (typeof d.viewers === 'number') viewerCount.value = d.viewers;
        } catch (e) {}
      };
      loadViewers();
      setInterval(loadViewers, 10 * 1000);

      // 设备当前状态：socket 实时推送 + 每 5 秒轮询兜底。
      // 推送偶尔会丢/延迟（尤其经反代），轮询能保证首页「正在使用」及时跟上。
      const loadDevices = async () => {
        try {
          const d = await fetch(SERVER + '/api/devices').then(r => r.json());
          if (d && typeof d === 'object' && !Array.isArray(d)) devices.value = d;
        } catch (e) {}
      };
      setInterval(loadDevices, 5 * 1000);

      // 每秒刷新 duration 计算 + 首页"最后更新时间"
      setInterval(() => {
        currentActivity.value = { ...currentActivity.value }; // 触发响应式
        tick.value++; // 首页时间每秒刷新
      }, 1000);

      // 首页背景视差：监听鼠标移动
      document.addEventListener('mousemove', onLandingMouseMove);

      // 默认选中第一个设备
      watch(sortedDevices, (list) => {
        if (!selectedDevice.value && list.length > 0) {
          selectedDevice.value = list[0]._id;
        }
      }, { immediate: true });

      // 切换设备后，重新拉取该设备的天气 / 今日总结 / 热力墙 / 智能洞察
      watch(selectedDevice, () => { loadWeather(); loadSummary(); loadHeatmap(); loadInsights(false); });
    });

    onUnmounted(() => {
      if (refreshTimer) clearInterval(refreshTimer);
      if (summaryTimer) clearInterval(summaryTimer);
      if (insightsTimer) clearInterval(insightsTimer);
      if (heatmapTimer) clearInterval(heatmapTimer);
      document.removeEventListener('mousemove', onLandingMouseMove);
      window.removeEventListener('hashchange', onHashChange);
      if (parallaxRAF) cancelAnimationFrame(parallaxRAF);
      clearTimeout(landingTimer);
    });

    return {
      devices, sortedDevices, onlineCount, todayStr, selectedDevice, selectedDeviceInfo,
      showDeviceDrawer, selectDevice, showDrawerHint, dismissDrawerHint,
      activityStream, filteredActivity,
      streamDate, streamDateLabel, isToday, canGoNext, todayKey, shiftDate, openDatePicker, onPickDate, dateInput,
      hourlyChartEl,
      summary, insights, aiText, insightsLoading, loadInsights, rankPct, panelInsights, hourlyMax,
      heatmap, heatmapColor, heatmapDayLabel, heatmapCells, heatmapMonths, ghWeekdays,
      currentActivity, currentActivityList, currentDoing,
      clockText, streamDateMeta, nowEmoji, scrollToPanel,
      chat, chatDraft, chatUnread, toasts, myNickname, sendChat, chatList, showChatToast, dismissToast, openChatFromToast,
      aiHistory, aiDraft, aiLoading, sendAi, aiList,
      fabOpen, fab, toggleFab,
      viewerCount, weather, showInteractive, dark, themeMode, toggleTheme, lang, t, tpl, toggleLang,
      route, enterDashboard, bgParallaxStyle, landingChanged, landingAppText, landingMood, landingTime, ownerName,
      deviceIcon, screenStateText, formatTime, formatDuration, timeAgo, doingText, locText,
    };
  }
}).mount('#app');
hideBoot();
