/* effects.js — 页面动效：confetti、点击粒子、标题切换 */
(function () {
  'use strict';

  // ===== 1. 页面加载完成后的 realistic confetti =====
  function fireConfetti() {
    if (typeof confetti !== 'function') return;
    var count = 200;
    var defaults = { origin: { y: 0.7 } };
    function fire(particleRatio, opts) {
      confetti(Object.assign({}, defaults, opts, {
        particleCount: Math.floor(count * particleRatio)
      }));
    }
    fire(0.25, { spread: 26, startVelocity: 55 });
    fire(0.2, { spread: 60 });
    fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
    fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
    fire(0.1, { spread: 120, startVelocity: 45 });
  }

  if (document.readyState === 'complete') {
    fireConfetti();
  } else {
    window.addEventListener('load', fireConfetti);
  }

  // ===== 2. 标签页标题切换（跟随当前语言）=====
  var TITLES = {
    zh: { away: '😢 你怎么走惹', back: '👋 快回来呀！', welcome: '🎉 欢迎回来！' },
    en: { away: '😢 Where did you go?', back: '👋 Come back!', welcome: '🎉 Welcome back!' },
    fr: { away: '😢 Où es-tu parti ?', back: '👋 Reviens vite !', welcome: '🎉 Bon retour !' }
  };
  function titleText(key) {
    var l = document.documentElement.getAttribute('data-lang') || 'zh';
    return (TITLES[l] || TITLES.zh)[key];
  }
  var titleTimeout;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      document.title = titleText('away');
      titleTimeout = setTimeout(function () {
        document.title = titleText('back');
      }, 3000);
    } else {
      clearTimeout(titleTimeout);
      document.title = titleText('welcome');
      setTimeout(function () {
        document.title = document.documentElement.getAttribute('data-doc-title') || 'stalk';
      }, 2000);
    }
  });

  // ===== 3. 鼠标点击粒子特效（基于 sketch.min.js 第二版） =====
  var Sketch = (function () {
    "use strict";
    function e(e) { return "[object Array]" == Object.prototype.toString.call(e); }
    function t(e) { return "function" == typeof e; }
    function n(e) { return "number" == typeof e; }
    function o(e) { return "string" == typeof e; }
    function r(e) { return E[e] || String.fromCharCode(e); }
    function i(e, t, n) { for (var o in t) (n || !e.hasOwnProperty(o)) && (e[o] = t[o]); return e; }
    function u(e, t) { return function () { e.apply(t, arguments); }; }
    function a(e) { var n = {}; for (var o in e) n[o] = t(e[o]) ? u(e[o], e) : e[o]; return n; }
    function c(e) {
      function n(n) { t(n) && n.apply(e, [].splice.call(arguments, 1)); }
      function u(e) { for (_ = 0; _ < J.length; _++)G = J[_], o(G) ? O[(e ? "add" : "remove") + "EventListener"].call(O, G, k, !1) : t(G) ? k = G : O = G; }
      function c() { L(T), T = I(c), U || (n(e.setup), U = t(e.setup), n(e.resize)), e.running && !j && (e.dt = (B = +new Date) - e.now, e.millis += e.dt, e.now = B, n(e.update), e.autoclear && K && e.clear(), n(e.draw)), j = ++j % e.interval; }
      function l() { O = Y ? e.style : e.canvas, D = Y ? "px" : "", e.fullscreen && (e.height = w.innerHeight, e.width = w.innerWidth), O.height = e.height + D, O.width = e.width + D, e.retina && K && X && (O.height = e.height * X, O.width = e.width * X, O.style.height = e.height + "px", O.style.width = e.width + "px", e.scale(X, X)), U && n(e.resize); }
      function s(e, t) { return N = t.getBoundingClientRect(), e.x = e.pageX - N.left - w.scrollX, e.y = e.pageY - N.top - w.scrollY, e; }
      function f(t, n) { return s(t, e.element), n = n || {}, n.ox = n.x || t.x, n.oy = n.y || t.y, n.x = t.x, n.y = t.y, n.dx = n.x - n.ox, n.dy = n.y - n.oy, n; }
      function g(e) { if (e.preventDefault(), W = a(e), W.originalEvent = e, W.touches) for (M.length = W.touches.length, _ = 0; _ < W.touches.length; _++)M[_] = f(W.touches[_], M[_]); else M.length = 0, M[0] = f(W, V); return i(V, M[0], !0), W; }
      function h(t) { for (t = g(t), q = (Q = J.indexOf(z = t.type)) - 1, e.dragging = /down|start/.test(z) ? !0 : /up|end/.test(z) ? !1 : e.dragging; q;)o(J[q]) ? n(e[J[q--]], t) : o(J[Q]) ? n(e[J[Q++]], t) : q = 0; }
      function p(t) { F = t.keyCode, H = "keyup" == t.type, Z[F] = Z[r(F)] = !H, n(e[t.type], t); }
      function v(t) { e.autopause && ("blur" == t.type ? b : C)(), n(e[t.type], t); }
      function C() { e.now = +new Date, e.running = !0; }
      function b() { e.running = !1; }
      function P() { (e.running ? b : C)(); }
      function A() { K && e.clearRect(0, 0, e.width, e.height); }
      function S() { R = e.element.parentNode, _ = x.indexOf(e), R && R.removeChild(e.element), ~_ && x.splice(_, 1), u(!1), b(); }
      var T, k, O, R, N, _, D, B, G, W, z, F, H, q, Q, j = 0, M = [], U = !1, X = w.devicePixelRatio, Y = e.type == m, K = e.type == d, V = { x: 0, y: 0, ox: 0, oy: 0, dx: 0, dy: 0 }, J = [e.element, h, "mousedown", "touchstart", h, "mousemove", "touchmove", h, "mouseup", "touchend", h, "click", y, p, "keydown", "keyup", w, v, "focus", "blur", l, "resize"], Z = {}; for (F in E)Z[E[F]] = !1; return i(e, { touches: M, mouse: V, keys: Z, dragging: !1, running: !1, millis: 0, now: 0 / 0, dt: 0 / 0, destroy: S, toggle: P, clear: A, start: C, stop: b }), x.push(e), e.autostart && C(), u(!0), l(), c(), e;
    }
    for (var l, s, f = "E LN10 LN2 LOG2E LOG10E PI SQRT1_2 SQRT2 abs acos asin atan ceil cos exp floor log round sin sqrt tan atan2 pow max min".split(" "), g = "__hasSketch", h = Math, d = "canvas", p = "webgl", m = "dom", y = document, w = window, x = [], v = { fullscreen: !0, autostart: !0, autoclear: !0, autopause: !0, container: y.body, interval: 1, globals: !0, retina: !1, type: d }, E = { 8: "BACKSPACE", 9: "TAB", 13: "ENTER", 16: "SHIFT", 27: "ESCAPE", 32: "SPACE", 37: "LEFT", 38: "UP", 39: "RIGHT", 40: "DOWN" }, C = { CANVAS: d, WEB_GL: p, WEBGL: p, DOM: m, instances: x, install: function (t) { if (!t[g]) { for (var o = 0; o < f.length; o++)t[f[o]] = h[f[o]]; i(t, { TWO_PI: 2 * h.PI, HALF_PI: h.PI / 2, QUATER_PI: h.PI / 4, random: function (t, o) { return e(t) ? t[~~(h.random() * t.length)] : (n(o) || (o = t || 1, t = 0), t + h.random() * (o - t)); }, lerp: function (e, t, n) { return e + n * (t - e); }, map: function (e, t, n, o, r) { return (e - t) / (n - t) * (r - o) + o; } }), t[g] = !0; } }, create: function (e) { return e = i(e || {}, v), e.globals && C.install(self), l = e.element = e.element || y.createElement(e.type === m ? "div" : "canvas"), s = e.context = e.context || function () { switch (e.type) { case d: return l.getContext("2d", e); case p: return l.getContext("webgl", e) || l.getContext("experimental-webgl", e); case m: return l.canvas = l; } }(), e.container.appendChild(l), C.augment(s, e); }, augment: function (e, t) { return t = i(t || {}, v), t.element = e.canvas || e, t.element.className += " sketch", i(e, t, !0), c(e); } }, b = ["ms", "moz", "webkit", "o"], P = self, A = 0, S = "AnimationFrame", T = "request" + S, k = "cancel" + S, I = P[T], L = P[k], O = 0; O < b.length && !I; O++)I = P[b[O] + "Request" + S], L = P[b[O] + "Cancel" + T]; return P[T] = I = I || function (e) { var t = +new Date, n = h.max(0, 16 - (t - A)), o = setTimeout(function () { e(t + n); }, n); return A = t + n, o; }, P[k] = L = L || function (e) { clearTimeout(e); }, C;
  })();

  if (document.getElementById("clickCanvas")) {
    function Particle(x, y, radius) { this.init(x, y, radius); }
    Particle.prototype = {
      init: function (x, y, radius) {
        this.alive = true;
        this.radius = radius || 10;
        this.wander = 0.15;
        this.theta = random(TWO_PI);
        this.drag = 0.92;
        this.color = '#ffeb3b';
        this.x = x || 0.0;
        this.y = y || 0.0;
        this.vx = 0.0;
        this.vy = 0.0;
      },
      move: function () {
        this.x += this.vx;
        this.y += this.vy;
        this.vx *= this.drag;
        this.vy *= this.drag;
        this.theta += random(-0.5, 0.5) * this.wander;
        this.vx += sin(this.theta) * 0.1;
        this.vy += cos(this.theta) * 0.1;
        this.radius *= 0.96;
        this.alive = this.radius > 0.5;
      },
      draw: function (ctx) {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, TWO_PI);
        ctx.fillStyle = this.color;
        ctx.fill();
      }
    };
    var MAX_PARTICLES = 50;
    var COLOURS = ["#5ee4ff", "#f44033", "#ffeb3b", "#F38630", "#FA6900", "#f403e8", "#F9D423"];
    var particles = [];
    var pool = [];
    var clickparticle = Sketch.create({ container: document.getElementById('clickCanvas') });
    clickparticle.spawn = function (x, y) {
      if (particles.length >= MAX_PARTICLES) pool.push(particles.shift());
      var particle = pool.length ? pool.pop() : new Particle();
      particle.init(x, y, random(5, 20));
      particle.wander = random(0.5, 2.0);
      particle.color = random(COLOURS);
      particle.drag = random(0.9, 0.99);
      var theta = random(TWO_PI);
      var force = random(1, 5);
      particle.vx = sin(theta) * force;
      particle.vy = cos(theta) * force;
      particles.push(particle);
    };
    clickparticle.update = function () {
      var i, particle;
      for (i = particles.length - 1; i >= 0; i--) {
        particle = particles[i];
        if (particle.alive) particle.move();
        else pool.push(particles.splice(i, 1)[0]);
      }
    };
    clickparticle.draw = function () {
      clickparticle.globalCompositeOperation = 'lighter';
      for (var i = particles.length - 1; i >= 0; i--) {
        particles[i].draw(clickparticle);
      }
    };
    document.addEventListener("mousedown", function (e) {
      var max, j;
      if ("TEXTAREA" !== e.target.nodeName && "INPUT" !== e.target.nodeName && "A" !== e.target.nodeName && "I" !== e.target.nodeName && "IMG" !== e.target.nodeName) {
        for (max = random(15, 20), j = 0; j < max; j++) clickparticle.spawn(e.clientX, e.clientY);
      }
    });
  }
})();

/* ====== 樱花花瓣飘落 ======
   参考 live-dashboard 的 sakura petal system：纯 CSS 动画，JS 只负责生成 20 片花瓣。
   花瓣放在背景层（桌面 z-index:-1 / 首页绝对定位），不挡点击、不挡内容。 */
(function () {
  var boxes = document.querySelectorAll('.sakura-container');
  if (!boxes.length) return;
  var TOTAL = 20;
  for (var b = 0; b < boxes.length; b++) {
    if (boxes[b].childElementCount) continue;
    for (var i = 0; i < TOTAL; i++) {
      var petal = document.createElement('i');
      petal.className = 'sakura-petal sakura-petal-' + i;
      boxes[b].appendChild(petal);
    }
  }
})();

/* ====== 夜色萤火 ======
   深色主题下在背景里飘的光点。位置 / 大小 / 呼吸节奏全部随机，
   同样只动 transform 与 opacity，纯装饰不挡点击。 */
(function () {
  var boxes = document.querySelectorAll('.firefly-container');
  if (!boxes.length) return;
  var TOTAL = 26;
  for (var b = 0; b < boxes.length; b++) {
    if (boxes[b].childElementCount) continue;
    for (var i = 0; i < TOTAL; i++) {
      var f = document.createElement('i');
      var size = 2 + Math.random() * 3.5;
      f.className = 'firefly';
      f.style.left = (Math.random() * 100).toFixed(2) + '%';
      f.style.top = (Math.random() * 100).toFixed(2) + '%';
      f.style.width = size.toFixed(1) + 'px';
      f.style.height = size.toFixed(1) + 'px';
      f.style.animationDuration = (12 + Math.random() * 14).toFixed(1) + 's, ' + (3 + Math.random() * 4).toFixed(1) + 's';
      f.style.animationDelay = (-Math.random() * 20).toFixed(1) + 's, ' + (-Math.random() * 5).toFixed(1) + 's';
      boxes[b].appendChild(f);
    }
  }
})();
