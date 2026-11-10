/* security.js — 前端基础防护：禁用右键、屏蔽 F12/开发者工具快捷键、反爬虫 */
(function () {
  'use strict';

  var enabled = true;
  try {
    // 允许 URL 加 ?dev=1 临时关闭前端防护，方便自己调试
    enabled = new URL(location.href).searchParams.get('dev') !== '1';
  } catch (e) {}
  if (!enabled) return;

  // ===== 1. 禁用右键菜单 =====
  document.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    return false;
  });

  // ===== 2. 屏蔽常见开发者工具快捷键 =====
  document.addEventListener('keydown', function (e) {
    var k = e.key || e.keyCode;
    // F12
    if (k === 'F12' || k === 123) { e.preventDefault(); return false; }
    // Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+Shift+C
    if (e.ctrlKey && e.shiftKey && (k === 'I' || k === 'J' || k === 'C' || k === 73 || k === 74 || k === 67)) {
      e.preventDefault(); return false;
    }
    // Ctrl+U 查看源码
    if (e.ctrlKey && (k === 'U' || k === 85)) { e.preventDefault(); return false; }
    // Cmd+Option+I/J (Mac)
    if (e.metaKey && e.altKey && (k === 'I' || k === 'J' || k === 73 || k === 74)) {
      e.preventDefault(); return false;
    }
  });

  // ===== 3. DevTools 打开检测（控制台打印大尺寸对象触发 debugger） =====
  function devToolsDetect() {
    var threshold = 160;
    var check = function () {
      var start = performance.now();
      debugger;
      var duration = performance.now() - start;
      if (duration > threshold) {
        document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0a0e17;color:#fff;font-size:1.2rem;padding:20px;text-align:center">👀 检测到开发者工具，页面已停用。<br>请关闭后刷新。</div>';
        window.location.href = 'about:blank';
      }
    };
    setInterval(check, 1200);
  }
  // 仅桌面环境启用 debugger 陷阱，避免移动端误伤
  if (!/Mobi|Android|iPhone|iPad|HarmonyOS/i.test(navigator.userAgent)) {
    devToolsDetect();
  }

  // ===== 4. 简单反爬虫：禁用常见自动化特征 =====
  (function antiBot() {
    var w = window;
    var d = document;
    // 检测 headless 特征
    if (navigator.webdriver) {
      d.body.innerHTML = '';
      throw new Error('bot detected');
    }
    // 覆盖 console 几个方法，防止简单脚本直接读取
    try {
      Object.defineProperty(w, 'chrome', { get: function () { return undefined; }, configurable: false });
    } catch (e) {}
  })();
})();
