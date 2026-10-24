'use strict';
// 界面框架：顶部 HUD、图层坞、详情面板（概览 → 展开详情）、工具坞、草案栏、冲突处理、开始界面与对话框
(function (CM) {
  const U = CM.U, CFG = CM.CFG, D = CM.DATA, M = CM.Metro;
  const h = U.h, I = CM.ICON, ic = CM.icon;
  const snd = function (name) { if (CM.Sound) CM.Sound.play(name); };

  // 分析图层（v1.9 起分为三组）：城市（人口、职住、设施出行需求）· 交通（拥堵、出行方向）· 地铁（覆盖、车站客流、服务缺口）
  const LAYER_GROUPS = [['city', '城市'], ['traffic', '交通'], ['metro', '地铁']];
  const LAYERS = [
    { id: 'pop', group: 'city', name: '人口密度', icon: 'lyPop', color: '#e9641f', desc: '各街区常住人口' },
    { id: 'jobs', group: 'city', name: '住宅与就业', icon: 'lyJobs', color: '#6447dc', desc: '居住与岗位的分布' },
    { id: 'land', group: 'city', name: '地价', icon: 'lyLand', color: '#b45309', desc: '各街区地价（仅经营模式）', need: 'land' },
    { id: 'fac', group: 'city', name: '设施出行需求', icon: 'lyFac', color: '#c2410c', desc: '重要设施与各片区吸引的出行（按目的）' },
    { id: 'cong', group: 'traffic', name: '道路拥堵', icon: 'lyCong', color: '#df3030', desc: '主要道路当前的拥堵程度' },
    { id: 'flow', group: 'traffic', name: '出行方向', icon: 'lyFlow', color: '#2557d6', desc: '各片区的主要出行方向' },
    { id: 'cover', group: 'metro', name: '地铁覆盖', icon: 'lyCover', color: '#14a252', desc: '步行可达车站的范围与阻隔' },
    { id: 'station', group: 'metro', name: '车站客流', icon: 'lyStation', color: '#109e90', desc: '客流与运力负荷' },
    { id: 'gap', group: 'metro', name: '地铁服务缺口', icon: 'lyGap', color: '#b91c1c', desc: '出行需求大但地铁服务不足的地方' },
  ];
  UI.LAYERS = LAYERS;
  UI.weekdayName = function (ck) { const w = new Date(Date.UTC(ck.y, ck.m - 1, ck.d)).getUTCDay(); return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][w] + (w === 0 || w === 6 ? '（周末）' : ''); };
  // 详情页图标与配色
  const PAGE_ICON = {
    build: ['hammer', 'b-blue'], station: ['station', 'b-teal'], line: ['route', 'b-blue'], road: ['car', 'b-orange'], zone: ['map', 'b-slate'],
    finance: ['coin', 'b-gold'], tasks: ['flag', 'b-violet'], date: ['clock', 'b-teal'], saves: ['save', 'b-blue'], help: ['help', 'b-slate'], data: ['info', 'b-slate'],
    metric: ['chart', 'b-blue'], multi: ['layers', 'b-blue'], facility: ['pin', 'b-orange'],
  };
  const METRIC_ICON = { pop: ['people', 'b-blue'], share: ['metro', 'b-teal'], cong: ['car', 'b-orange'], commute: ['timer', 'b-violet'], sat: ['smile', 'b-green'] };
  // 统一交互反馈的范围：按钮、可点击的行与卡片、列表选项与标签页
  const PRESS_SEL = 'button, .clickable, [role="option"], [role="tab"]';

  function UI(R) {
    this.R = R;
    this.selection = null; this.layer = 'none'; this.highlightLine = null; this.hoverConflict = null;
    this.stack = []; this.open = {}; this.live = [];
    this.save = { state: 'none', at: null, msg: '' };
    this._manualSaves = new Set();
    this._celebrationQueue = []; this._celebrationActive = null;
    this.lastTick = 0; this.lastSlow = 0;
    this.buildChrome();
    const self = this;
    // 统一的点击音效：按钮、可点击的列表行与选项（标签切换等用 data-silent 自行播放更轻的音效）
    document.addEventListener('click', function (e) { const b = e.target.closest && e.target.closest(PRESS_SEL); if (b && !b.disabled && !b.dataset.silent && !b.classList.contains('switch')) snd('click'); }, true);
  }
  CM.UI = UI;
  UI.prototype.g = function () { return CM.game; };

  // ======================== 外框 ========================
  // 布局：左上「城市与时间」（日期、速度、推进）；右上「指标」与「操作」（任务、统计、设置、菜单）；
  // 左侧「视图与图层」；底部中间「建设工具」；右下「缩放」；右侧详情面板。
  UI.prototype.buildChrome = function () {
    const app = document.getElementById('app');
    const self = this;
    this.pills = {};
    const pill = function (key, label, icon, badgeCls, cls) {
      const badge = h('span', { class: 'badge ' + badgeCls }, ic(icon));
      const v = h('span', { class: 'v' }, '—'), k = h('span', { class: 'k' }, label);
      const b = h('button', { class: 'pill ' + (cls || ''), 'data-tip': label + ' · 点击查看详情', onclick: function () { self.openTop(key); } }, badge, h('span', { class: 'tx' }, k, v));
      self.pills[key] = { el: b, v: v, k: k, badge: badge };
      return b;
    };
    // 日期（带一天进度环）
    const C = 2 * Math.PI * 15;
    const ring = h('span', { class: 'dayring' });
    ring.innerHTML = '<svg class="r" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" fill="none" stroke="var(--surface-3)" stroke-width="3.5"/><circle class="arc" cx="18" cy="18" r="15" fill="none" stroke="url(#dayg)" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="' + C + '" stroke-dashoffset="' + C + '"/><defs><linearGradient id="dayg" x1="0" x2="1"><stop offset="0" stop-color="#2fd1bf"/><stop offset="1" stop-color="#4f8bff"/></linearGradient></defs></svg>';
    const ringIco = ic('sun'); ring.appendChild(ringIco);
    this.dayRing = { el: ring, arc: ring.querySelector('.arc'), ico: ringIco, C: C, night: null };
    const dateV = h('span', { class: 'v' }, '—'), dateK = h('span', { class: 'k' }, '');
    const datePill = h('button', { class: 'pill daypill', 'data-tip': '日期、时段与城市发展', onclick: function () { self.openTop('date'); } }, ring, h('span', { class: 'tx' }, dateK, dateV));
    this.pills.date = { el: datePill, v: dateV, k: dateK };
    this.tbtns = {};
    const spd = function (id, label, n, tip, key) {
      const b = h('button', { class: 'sbtn' + (n === 0 ? ' pz' : ''), 'data-tip': tip, 'data-key': key, onclick: function () { if (n === 0) self.togglePause(); else self.setSpeed(n); } }, n === 0 ? ic('pause') : label);
      self.tbtns[id] = b; return b;
    };
    const jmp = function (id, label, n, tip) { const b = h('button', { class: 'jbtn', 'data-tip': tip, onclick: function () { self.jump(n); } }, label); self.tbtns[id] = b; return b; };
    // 右上操作按钮
    this.hbtns = {};
    const hb = function (key, icon, tip, onclick, keyHint) { const b = h('button', { class: 'hbtn', 'data-tip': tip, 'data-key': keyHint || null, onclick: onclick }, ic(icon)); self.hbtns[key] = b; return b; };
    this.taskCnt = h('span', { class: 'cnt' }, '0');
    const taskBtn = hb('tasks', 'flag', '任务', function () { self.openTop('tasks'); });
    taskBtn.appendChild(this.taskCnt);
    this.top = h('header', { id: 'hudTop', class: 'hud hidden' },
      h('div', { class: 'cluster glass citybar' },
        h('div', { class: 'brand' }, h('img', { src: 'img/logo-white.png', alt: '城市与地铁' })),
        datePill,
        h('div', { class: 'speed' }, spd('pause', '', 0, '暂停 / 继续', '空格'), spd('s1', '1×', 1, '正常速度', '1'), spd('s2', '3×', 2, '3 倍速', '2'), spd('s3', '8×', 3, '8 倍速', '3')),
        h('div', { class: 'jumps' }, jmp('month', '+1月', 1, '推进 1 个月'), jmp('year', '+1年', 12, '推进 1 年（结束后显示变化）'))),
      h('div', { class: 'spacer' }),
      h('div', { class: 'cluster glass metrics' },
        pill('money', '资金', 'coin', 'b-gold'), pill('econ', '经济增长', 'trend', 'b-violet', 'opt2'), pill('pop', '人口', 'people', 'b-blue', 'opt2'), pill('share', '地铁分担率', 'metro', 'b-teal', 'opt3'),
        pill('cong', '拥堵指数', 'car', 'b-orange', 'opt5'), pill('sat', '满意度', 'smile', 'b-green', 'opt4')),
      h('div', { class: 'cluster glass actions' },
        hb('search', 'search', '搜索车站、线路、道路、区域', function () { self.openSearch(); }, '/'),
        taskBtn,
        hb('stats', 'chart', '城市统计', function () { self.openStats(); }, 'G'),
        hb('theme', 'moon', '深色模式', function () { self.toggleTheme(); }, 'N'),
        hb('settings', 'gear', '设置', function () { self.showSettings(); }),
        hb('menu', 'menu', '菜单', function (e) { self.showMenu(e.currentTarget); })));
    // 窄屏（手机）顶栏只保留常用按钮：深浅模式与设置改在菜单中
    this.hbtns.theme.classList.add('wide-only'); this.hbtns.settings.classList.add('wide-only');
    // 左侧：视图（2D / 2.5D / 地下 / 线路图）与图层（一个按钮，弹出图层列表）
    const vb = function (id, icon, tip, key, onclick, cls) { const b = h('button', { class: 'dockbtn ' + (cls || 'view'), 'data-tip': tip, 'data-key': key || null, 'data-side': 'right', onclick: onclick }, ic(icon)); self.tbtns[id] = b; return b; };
    this.dock = h('aside', { id: 'dock', class: 'hud glass hidden' },
      vb('d2', 'view2d', '2D 地图', null, function () { self.setView(false); }),
      vb('iso', 'view3d', '2.5D 城市', 'T', function () { self.setView(true); }),
      vb('under', 'under', '地下视图', 'U', function () { self.toggleUnder(); }),
      vb('netmap', 'network', '线路示意图', 'K', function () { self.openNetMap(); }, 'plain'),
      h('div', { class: 'dock-sep' }));
    // 分析图层：每个图层一个按钮，再次点击关闭；开启时按钮显示该图层的颜色
    this.dockBtns = {};
    let lastGroup = null;
    for (const L of LAYERS) {
      if (lastGroup && L.group !== lastGroup) this.dock.appendChild(h('div', { class: 'dock-sep thin' }));
      lastGroup = L.group;
      const gname = (LAYER_GROUPS.find(function (x) { return x[0] === L.group; }) || ['', ''])[1];
      const b = h('button', { class: 'dockbtn layer', 'data-tip': gname + ' · ' + L.name + ' · ' + L.desc, 'data-side': 'right', onclick: function () { self.setLayer(self.layer === L.id ? 'none' : L.id); } }, ic(L.icon));
      b.style.setProperty('--lc', L.color);
      this.dockBtns[L.id] = b; this.dock.appendChild(b);
    }
    this.legendCard = h('aside', { id: 'legendCard', class: 'hud glass hidden' });
    // 左下：缩放
    const R = this.R;
    this.zoomCtl = h('div', { id: 'zoomCtl', class: 'hud glass hidden' },
      h('button', { 'data-tip': '放大', 'data-key': '+', 'data-side': 'right', onclick: function () { R.zoomAt(R.w / 2, R.h / 2, 1.5); } }, ic('plus')),
      h('button', { 'data-tip': '缩小', 'data-key': '−', 'data-side': 'right', onclick: function () { R.zoomAt(R.w / 2, R.h / 2, 1 / 1.5); } }, ic('minus')),
      h('button', { 'data-tip': '全图', 'data-key': 'F', 'data-side': 'right', onclick: function () { R.fitAll(); } }, ic('expand')));
    // 右侧详情
    this.right = h('aside', { id: 'rightPanel', class: 'hud glass panel closed hidden', inert: true, 'aria-hidden': 'true' });
    this.rTitle = h('div', { class: 'p-title' }, '');
    this.rBadge = h('span', { class: 'badge b-blue' }, ic('info'));
    this.rBack = h('button', { class: 'iconbtn', 'data-tip': '返回', onclick: function () { self.back(); } }, ic('back'));
    this.rBody = h('div', { class: 'p-body' });
    // 输入期间推迟的页面刷新：离开输入框后补上（稍后执行，避免吞掉随后的按钮点击）
    this.rBody.addEventListener('focusout', function () {
      if (!self._pendingRefresh) return;
      setTimeout(function () {
        const a = document.activeElement;
        if (!self._pendingRefresh || (a && self.rBody.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'))) return;
        self._pendingRefresh = false; self.rerenderPage();
      }, 300);
    });
    this.right.append(h('div', { class: 'p-head' }, this.rBack, this.rBadge, this.rTitle, h('button', { class: 'iconbtn', 'data-tip': '收起', 'data-key': 'Esc', onclick: function () { self.closePanel(); } }, ic('close'))), this.rBody);
    // 底部：建设工具
    const tb = function (id, icon, label, key, onclick, cls) {
      const b = h('button', { class: 'tbtn ' + (cls || ''), 'data-tip': label, 'data-key': key, onclick: onclick }, ic(icon), h('span', { class: 'lb' }, label));
      self.tbtns[id] = b; return b;
    };
    this.toolInd = h('span', { class: 'tind' });
    this.toolbar = h('nav', { id: 'toolbar', class: 'hud glass hidden' }, this.toolInd,
      tb('select', 'cursor', '选择', 'V', function () { self.tools.setTool('select'); }),
      tb('station', 'station', '建站', 'B', function () { self.tools.setTool('station'); }),
      tb('line', 'route', '绘线', 'L', function () { self.tools.setTool('line'); }),
      tb('edit', 'pencil', '修改', 'E', function () { self.tools.setTool('edit'); }),
      tb('demolish', 'bulldozer', '拆除', 'X', function () { self.tools.setTool('demolish'); }, 'danger'));
    // 工具条上方：建设草案栏 + 当前工具的选项条（线路、建设方式、车站规模）
    this.draftbar = h('div', { id: 'draftbar', class: 'glass hidden' });
    this.toolopts = h('div', { id: 'toolopts', class: 'glass hidden' });
    this.bstack = h('div', { id: 'buildStack', class: 'hud hidden' }, this.draftbar, this.toolopts);
    // 顶部中间信息流：暂停提示、状态横幅、消息
    this.pauseChip = h('button', { class: 'pausechip hidden', onclick: function () { self.togglePause(); } }, ic('pause'), h('span', null, '已暂停'), h('kbd', null, '空格'), h('span', { class: 'muted' }, '继续'));
    this.banner = h('div', { id: 'banner' });
    this.toasts = h('div', { id: 'toasts' });
    this.feed = h('div', { id: 'feed', class: 'hidden' }, this.pauseChip, this.banner, this.toasts);
    this.feed.addEventListener('transitionend', function (e) {
      if (e.target === self.feed && (e.propertyName === 'left' || e.propertyName === 'max-width')) self.placeFeed();
    });
    this.tip = h('div', { id: 'tooltip' });
    this.uitip = h('div', { id: 'uitip' });
    this.screen = h('div', { id: 'screen', class: 'hidden' });
    this.statsEl = h('div', { id: 'stats', class: 'hidden' });
    this.fxLayer = h('div', { id: 'fxLayer' });
    app.append(this.top, this.dock, this.legendCard, this.zoomCtl, this.right, this.toolbar, this.bstack, this.feed, this.tip, this.uitip, this.fxLayer, this.statsEl, this.screen);
    this.initTips();
    this.initPress();
    this.renderDock();
    this.layoutHud();
    window.addEventListener('resize', function () { self.layoutHud(); });
    CM.Settings.on(function (k) { if (k === 'uiScale') { self.layoutHud(); requestAnimationFrame(function () { self.renderToolbar(); }); } if (k === 'theme') self.renderThemeBtns(); });
    this.renderThemeBtns();
  };
  // 消息与提示条居中于地图未被遮挡的区域（右侧面板打开时向左让开，避免挡住面板上的分页）
  UI.prototype.placeFeed = function () {
    const f = this.feed; if (!f) return;
    if (window.innerWidth <= 760) { f.style.left = ''; f.style.maxWidth = ''; }
    else {
      const z = CM.Settings.get('uiScale') || 1;
      const open = this.right && !this.right.classList.contains('closed') && !this.right.classList.contains('hidden');
      const rw = open ? this.right.getBoundingClientRect().width + 24 : 0;
      // 左侧让开图层栏；教程时让开引导卡片
      const dock = document.body.classList.contains('has-coach') ? 420 * z + 40 : 76 * z, avail = window.innerWidth - rw - dock;
      f.style.left = ((dock + avail / 2) / z) + 'px';
      f.style.maxWidth = (Math.max(280, avail - 32) / z) + 'px';
    }
    // 空间不足时收起重复的暂停提示；顶栏暂停/继续按钮仍保留，图层标题和选项不被覆盖。
    const chip = this.pauseChip, card = this.legendCard;
    if (chip) {
      chip.classList.remove('overlap');
      if (card && !card.classList.contains('hidden')) {
        const a = chip.getBoundingClientRect(), b = card.getBoundingClientRect();
        chip.classList.toggle('overlap', a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
      }
    }
  };
  // 顶栏按有效宽度收起次要内容（界面放大时同样适用）
  UI.prototype.layoutHud = function () {
    this.placeFeed();
    const w = window.innerWidth / (CM.Settings.get('uiScale') || 1);
    for (const b of [1540, 1400, 1260, 1080, 960, 820]) this.top.classList.toggle('lt' + b, w < b);
    for (const k in this.pills) this.pills[k].el.classList.remove('squeezed');
    const self = this; requestAnimationFrame(function () { self.fitHud(); if (self.dropdown && self.dropdown._place) self.dropdown._place(); });
  };
  // 指标栏放不下时，按优先级从低到高收起（经济 → 满意度 → 分担率 → 人口 → 拥堵）
  UI.prototype.fitHud = function () {
    const m = this.top.querySelector('.cluster.metrics'); if (!m || !m.clientWidth) return;
    for (const k of ['econ', 'sat', 'share', 'pop', 'cong']) {
      if (m.scrollWidth <= m.clientWidth + 1) break;
      const el = this.pills[k].el; if (getComputedStyle(el).display !== 'none') el.classList.add('squeezed');
    }
  };
  UI.prototype.showHUD = function (on) {
    for (const el of [this.top, this.dock, this.right, this.toolbar, this.zoomCtl, this.feed, this.bstack]) {
      const inactive = !on || (el === this.right && el.classList.contains('closed'));
      if (inactive && el.contains(document.activeElement)) document.activeElement.blur();
      el.classList.toggle('hidden', !on);
      el.inert = inactive;
      el.setAttribute('aria-hidden', inactive ? 'true' : 'false');
    }
    if (!on) {
      this.draftbar.classList.add('hidden'); this.legendCard.classList.add('hidden'); this.statsEl.classList.add('hidden');
      if (this.legendCard.contains(document.activeElement)) document.activeElement.blur();
      this.legendCard.inert = true; this.legendCard.setAttribute('aria-hidden', 'true');
    }
    else { this.renderDock(); const self = this; requestAnimationFrame(function () { self.renderToolbar(); }); }
  };
  // 界面提示：带 data-tip 的元素悬停时显示（可附快捷键），替代浏览器默认 title
  UI.prototype.initTips = function () {
    const tipEl = this.uitip;
    let cur = null, timer = null;
    const show = function (el) {
      const key = el.getAttribute('data-key');
      tipEl.innerHTML = '';
      // 注意：原生 append(null) 会把 null 写成文字，没有快捷键时不能传 null
      tipEl.appendChild(h('span', null, el.getAttribute('data-tip')));
      if (key) tipEl.appendChild(h('kbd', null, key));
      tipEl.className = 'on';
      const r = el.getBoundingClientRect(), w = tipEl.offsetWidth, hh = tipEl.offsetHeight, side = el.getAttribute('data-side');
      let x, y;
      if (side === 'right') { x = r.right + 10; y = r.top + r.height / 2 - hh / 2; tipEl.classList.add('s-right'); }
      else if (side === 'left') { x = r.left - w - 10; y = r.top + r.height / 2 - hh / 2; tipEl.classList.add('s-left'); }
      else {
        x = r.left + r.width / 2 - w / 2;
        const below = r.top < window.innerHeight / 2;
        y = below ? r.bottom + 9 : r.top - hh - 9;
        tipEl.classList.add(below ? 's-below' : 's-above');
      }
      tipEl.style.left = U.clamp(x, 6, window.innerWidth - w - 6) + 'px';
      tipEl.style.top = U.clamp(y, 6, window.innerHeight - hh - 6) + 'px';
    };
    const hide = function () { clearTimeout(timer); cur = null; tipEl.className = ''; };
    document.addEventListener('pointerover', function (e) {
      const el = e.target.closest && e.target.closest('[data-tip]');
      if (el === cur) return;
      hide();
      if (!el || e.pointerType === 'touch') return;
      cur = el;
      timer = setTimeout(function () { if (cur === el && document.body.contains(el)) show(el); }, 380);
    });
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('pointerout', function (e) {
      if (cur && (!e.relatedTarget || !cur.contains(e.relatedTarget))) hide();
    });
    document.addEventListener('keydown', hide, true);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    window.addEventListener('blur', hide);
  };
  // 按压反馈：所有可点击元素统一的涟漪（放在按钮自身圆角内的裁切层里，不影响角标等溢出内容）
  UI.prototype.initPress = function () {
    document.addEventListener('pointerdown', function (e) {
      if (CM.Settings.reducedMotion() || e.button > 0) return;
      const b = e.target.closest && e.target.closest(PRESS_SEL);
      if (!b || b.disabled || b.classList.contains('switch') || b.hasAttribute('data-noripple')) return;
      const r = b.getBoundingClientRect(); if (r.width < 10 || r.height < 10) return;
      const d = Math.max(r.width, r.height) * 1.6;
      let wrap = null;
      for (const c of b.children) if (c.classList.contains('rip-wrap')) { wrap = c; break; }
      if (!wrap) { wrap = h('span', { class: 'rip-wrap', 'aria-hidden': 'true' }); b.appendChild(wrap); }
      const rp = h('span', { class: 'ripple', style: { width: d + 'px', height: d + 'px', left: (e.clientX - r.left - d / 2) + 'px', top: (e.clientY - r.top - d / 2) + 'px' } });
      wrap.appendChild(rp);
      setTimeout(function () { rp.remove(); }, 600);
    }, true);
  };
  UI.prototype.blocking = function () { return !this.screen.classList.contains('hidden') || !this.statsEl.classList.contains('hidden') || !!(CM.NetMap && CM.NetMap.isOpen()) || !!(this.g() && this.g().jumping); };

  // ======================== 游戏接入 ========================
  UI.prototype.attachGame = function (g) {
    const self = this;
    this.clearCelebrations();
    this.selection = null; this.stack = []; this.closePanel(true);
    this.layer = 'none'; this.R.layer = 'none'; this.renderDock();
    g.on('toast', function (t) { self.toast(t.text, t.kind); });
    g.on('draft', function () { self.lastDraftChange = performance.now(); self.tools.syncDraft(); self.syncSelection(); self.renderDraftbar(); self.renderToolOpts(); self.refreshObjectPage(); });
    g.on('draftLive', function () { self.lastDraftChange = performance.now(); });
    g.on('prediction', function () { self.refreshPrediction(); self.renderDraftbar(); });
    g.on('network', function () { self.markUnsaved(); self.rerenderPage(); });
    g.on('finance', function () { self.markUnsaved(); self.rerenderPage(); self.scheduleAutosave(); });
    g.on('month', function () { self.markUnsaved(); self.rerenderPage(); if (!g.jumping) { self.scheduleAutosave(); if (g.speed > 0) snd('month'); } });
    g.on('autosave', function () { self.scheduleAutosave(); });
    g.on('failed', function (f) { snd('fail'); if (!g.jumping) self.showFailure(f); });
    g.on('jump', function () { snd('whoosh'); self.showJump(); });
    g.on('jumpProgress', function (p) { self.updateJump(p); });
    g.on('jumpDone', function (r) { snd('chime'); self.showJumpResult(r); self.scheduleAutosave(); if (r.failed) self.showFailure(r.failed); });
    g.on('speed', function () { self.renderToolbar(); });
    // 里程碑：消息提示；重大节点弹出庆祝横幅（跳月 / 跳年期间只记录）
    g.on('milestone', function (r) {
      if (g.jumping) return;
      const c = CM.Milestones.CAT[r.cat] || {};
      if (r.big) { snd('fanfare'); self.celebrate('里程碑：' + r.title, r.desc || '', c.color); }
      else self.toast('里程碑：' + r.title, 'good');
    });
    g.on('event', function (e) {
      if (e.tag === '任务' && e.title.indexOf('任务完成') === 0) { snd('fanfare'); if (!g.jumping) self.celebrate(e.title.replace(/^任务完成[:：]?\s*/, '任务完成：'), e.desc || '', '#f0a72b'); }
      else if (e.title.indexOf('新区域开放') === 0) {
        snd('unlock');
        const name = e.title.replace('新区域开放：', '');
        const rg = g.city.regions.find(function (r) { return r.name === name; });
        if (rg && rg.cx != null && !g.jumping) self.R.addFx('region', rg.cx, rg.cy, { name: name });
      }
    });
    this.save = { state: 'none', at: null, msg: '' };
    this.lastAuto = performance.now();
    this.showHUD(true);
    this.renderToolbar();
    this.renderDraftbar();
    this.tick(0, true);
  };

  // ======================== 每帧 ========================
  UI.prototype.tick = function (dt, force) {
    const g = this.g(); if (!g) return;
    if (this._celebrationActive || this._celebrationQueue.length) {
      if (this.blocking()) {
        const active = this._celebrationActive;
        if (active) {
          clearTimeout(this._celebrationTimer); clearTimeout(this._celebrationExitTimer);
          if (!active.closing) this._celebrationQueue.unshift(active.item);
          active.box.remove(); this._celebrationActive = null;
        }
      } else this.showNextCelebration();
    }
    const now = performance.now();
    if (force || now - this.lastTick > 250) {
      this.lastTick = now;
      this.updateTop();
      if (this.pageDailyStale && !g.model.dailyStale && this.stack.length) {
        const a = document.activeElement;
        if (a && this.rBody.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) this._pendingRefresh = true;
        else this.rerenderPage();
      }
      for (const f of this.live) { try { f(); } catch (e) { /* 页面已变化 */ } }
      if (CM.Stats && CM.Stats.isOpen()) CM.Stats.tick();
    }
    if (force || now - this.lastSlow > 1000) {
      this.lastSlow = now;
      this.updateBanner();
      this.renderDraftbar();
      if (now - this.lastAuto > 5 * 60 * 1000 && this.save.state !== 'saving' && !this.isSaved() && CM.Settings.get('autosave')) this.doAutosave();
    }
    const d = g.draft;
    if (d && (d.pred.state === 'idle' || d.pred.state === 'stale') && !this.tools.drag && this.lastDraftChange && now - this.lastDraftChange > 1200 && d.autoVer !== d.ver && !g.jumping && !g.pending) {
      d.autoVer = d.ver;
      const ev = g.draftEval();
      if (ev && ev.changed) g.requestPrediction();
    }
  };
  UI.prototype.drawOverlay = function (ctx, R) { this.tools.drawOverlay(ctx, R); };

  UI.prototype.updateTop = function () {
    const g = this.g(), c = this.pills, d = g.model.daily || {};
    const W = g.model.weights(g.clock.minute);
    const per = CFG.periods[g.model.hourPeriod[Math.floor(g.clock.minute / 60) % 24]];
    c.date.v.innerHTML = U.esc(g.clock.y + '年' + g.clock.m + '月' + g.clock.d + '日') + ' <small>' + U.fmtClock(g.clock.minute) + '</small>';
    c.date.k.textContent = UI.weekdayName(g.clock) + ' · ' + per.name;
    c.date.el.setAttribute('data-tip', g.stageName() + ' · 点击查看日期、时段与城市发展');
    const rg = this.dayRing, frac = (g.clock.minute % 1440) / 1440;
    rg.arc.setAttribute('stroke-dashoffset', String(rg.C * (1 - frac)));
    const night = g.clock.minute < 360 || g.clock.minute >= 1140;
    if (night !== rg.night) { rg.night = night; rg.ico.innerHTML = night ? I.moon : I.sun; rg.el.classList.toggle('night', night); }
    if (g.econ.isFree()) c.money.v.innerHTML = '∞ <small>自由建造</small>';
    else {
      const f = g.econ.funds;
      if (this._funds != null && Math.abs(f - this._funds) >= 300) this.moneyFloat(f - this._funds);
      this.tweenNum(c.money.v, this._funds == null ? f : this._funds, f, function (x) { return U.fmtMoney(x); });
      this._funds = f;
      c.money.v.className = 'v' + (f < 0 ? ' bad' : '');
    }
    const tot = this._tot && this._totVer === g.city.version ? this._tot : (this._tot = g.city.totals(), this._totVer = g.city.version, this._tot);
    this.tweenNum(c.pop.v, this._popShown == null ? tot.pop : this._popShown, tot.pop, U.fmtPeople);
    this._popShown = tot.pop;
    const hist = g.history, prev = hist.length > 1 ? hist[hist.length - 2] : null;
    const trend = function (cur, old, betterUp, pct) {
      if (old == null || !isFinite(old)) return '';
      const dlt = cur - old;
      if (Math.abs(dlt) < (pct ? 0.0005 : 0.005)) return '';
      return '<span class="trend ' + ((betterUp ? dlt > 0 : dlt < 0) ? 'good' : 'bad') + '">' + (dlt > 0 ? '▲' : '▼') + '</span>';
    };
    c.share.v.innerHTML = U.fmtPct(d.metroShare || 0) + ' ' + trend(d.metroShare || 0, prev && prev.share, true, true);
    if (!this._congT || performance.now() - this._congT > 900) { this._congT = performance.now(); this._cong = g.model.cityCongAt(W); }
    const cg = this._cong;
    c.cong.v.innerHTML = cg.toFixed(2) + ' <small>' + (cg < 1.25 ? '畅通' : (cg < 1.6 ? '缓行' : '拥堵')) + '</small>';
    c.cong.badge.className = 'badge ' + (cg < 1.25 ? 'b-green' : (cg < 1.6 ? 'b-orange' : 'b-red'));
    // 城市经济：最近一年的实际增速（尚无完整年度时为本年预测）与经济环境；教程等未启用的地图不显示
    const hasEco = !!(g.macro && CM.Macro);
    c.econ.el.classList.toggle('gone', !hasEco);
    if (hasEco && (!this._ecoT || performance.now() - this._ecoT > 1500 || this._ecoRev !== g.macro.rec.length)) {
      this._ecoT = performance.now(); this._ecoRev = g.macro.rec.length;
      const mv = CM.Macro.view(g), L = mv.last, gr = L && L.growth != null ? L.growth : mv.fc.growth;
      c.econ.v.innerHTML = U.esc(gr == null ? '—' : UI.pctS(gr)) + ' <small>' + U.esc(mv.env.label) + '</small>';
      c.econ.k.textContent = L && L.growth != null ? L.y + ' 年实际增长' : '本年预测增长';
      c.econ.badge.className = 'badge ' + (mv.env.cls === 'good' ? 'b-green' : (mv.env.cls === 'bad' ? 'b-red' : (mv.env.cls === 'warn' ? 'b-orange' : 'b-violet')));
      c.econ.el.setAttribute('data-tip', '城市经济：' + mv.env.label + ' · ' + (L ? L.y + ' 年 GDP ' + UI.fmtBig(L.nom) : '本年 GDP 预测 ' + UI.fmtBig(mv.fc.nom)) + ' · 点击查看');
    }
    const sat = g.econ.sat;
    c.sat.v.innerHTML = Math.round(sat) + ' ' + trend(sat, prev && prev.sat, true);
    const sk = sat >= 60 ? 'smile' : (sat >= 40 ? 'meh' : 'frown');
    if (c.sat.ico !== sk) { c.sat.ico = sk; c.sat.badge.className = 'badge ' + (sk === 'smile' ? 'b-green' : (sk === 'meh' ? 'b-orange' : 'b-red')); c.sat.badge.innerHTML = ''; c.sat.badge.appendChild(ic(sk)); }
    const n = g.tasks.active.length;
    this.taskCnt.textContent = n; this.taskCnt.style.display = n ? '' : 'none';
    const s = this.save;
    this.hbtns.menu.classList.toggle('warn-dot', s.state === 'error');
    // 存档状态：保存中在菜单按钮上显示脉动小点；悬停提示注明是否已保存
    this.hbtns.menu.classList.toggle('saving-dot', s.state === 'saving');
    const mt = '菜单 · ' + this.saveStatusText();
    if (mt !== this._menuTip) { this._menuTip = mt; this.hbtns.menu.setAttribute('data-tip', mt); }
    this.pauseChip.classList.toggle('hidden', !(g.speed === 0 && !g.jumping && this.screen.classList.contains('hidden')));
    this.fitHud();
    const top = this.stack[this.stack.length - 1];
    for (const k in c) {
      const kind = k === 'money' || k === 'econ' ? 'finance' : (k === 'date' ? 'date' : 'metric');
      let on = !!top && top.kind === kind && (kind !== 'metric' || top.id === k);
      if (on && kind === 'finance') on = (top.id === 'econ') === (k === 'econ');
      c[k].el.classList.toggle('on', on);
    }
    this.hbtns.tasks.classList.toggle('on', !!top && top.kind === 'tasks');
  };
  function fmtHM(t) { if (!t) return ''; const d = new Date(t); return U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes()); }
  // 存档状态：注明已保存的是哪个游戏时刻，避免把旧快照当作当前进度
  UI.prototype.saveStatusText = function () {
    const s = this.save;
    const at = s.clock ? s.clock.y + '年' + s.clock.m + '月' + s.clock.d + '日 ' + U.fmtClock(s.clock.minute) : '';
    if (s.state === 'saving') return '保存中…';
    if (s.state === 'error') return '保存失败';
    if (this.isSaved()) return '已保存（游戏时间 ' + at + '）';
    if (s.clock) return '有未保存的进度（上次保存：' + at + '）';
    return '尚未保存';
  };
  // 数字滚动：数值变化时在约 0.45 秒内平滑过渡
  UI.prototype.tweenNum = function (el, from, to, fmt) {
    if (el._tw && el._tw.to === to) return;
    if (from === to || CM.Settings.reducedMotion() || Math.abs(to - from) < Math.abs(to) * 0.0005) { el._tw = { to: to }; el.textContent = fmt(to); return; }
    const t0 = performance.now(), tw = el._tw = { to: to };
    const step = function (t) {
      if (el._tw !== tw) return;
      const k = Math.min(1, (t - t0) / 450), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  // 资金变化飘字（拨款、建设扣费等较大变化）
  UI.prototype.moneyFloat = function (d) {
    const g = this.g();
    if (!g || g.jumping || CM.Settings.reducedMotion()) return;
    const r = this.pills.money.el.getBoundingClientRect();
    const el = h('div', { class: 'floater ' + (d > 0 ? 'good' : 'bad'), style: { left: (r.left + r.width / 2) + 'px', top: (r.bottom - 6) + 'px' } }, (d > 0 ? '+' : '−') + U.fmtMoney(Math.abs(d)));
    this.fxLayer.appendChild(el);
    this.pills.money.el.classList.remove('flash-good', 'flash-bad'); void this.pills.money.el.offsetWidth;
    this.pills.money.el.classList.add(d > 0 ? 'flash-good' : 'flash-bad');
    if (d > 0) snd('coin');
    setTimeout(function () { el.remove(); }, 1700);
  };
  // 同时触发的开通、任务和成就依次展示，退出动画结束后再显示下一条。
  UI.prototype.clearCelebrations = function () {
    clearTimeout(this._celebrationTimer); clearTimeout(this._celebrationExitTimer);
    if (this._celebrationActive) this._celebrationActive.box.remove();
    this._celebrationActive = null; this._celebrationQueue.length = 0;
  };
  UI.prototype.celebrate = function (title, sub, color) {
    const item = { title: String(title || ''), sub: String(sub || ''), color: color };
    const same = function (o) { return o.title === item.title && o.sub === item.sub && o.color === item.color; };
    if ((this._celebrationActive && same(this._celebrationActive.item)) || this._celebrationQueue.some(same)) return;
    this._celebrationQueue.push(item);
    this.showNextCelebration();
    const count = this._celebrationActive && this._celebrationActive.box.querySelector('.celebrate-count');
    if (count) { count.hidden = !this._celebrationQueue.length; count.textContent = '另有 ' + this._celebrationQueue.length + ' 条'; }
  };
  UI.prototype.dismissCelebration = function () {
    const self = this, active = this._celebrationActive;
    if (!active || active.closing) return;
    clearTimeout(this._celebrationTimer); active.closing = true; active.box.classList.add('out');
    this._celebrationExitTimer = setTimeout(function () {
      if (self._celebrationActive !== active) return;
      active.box.remove(); self._celebrationActive = null; self.showNextCelebration();
    }, CM.Settings.reducedMotion() ? 0 : 350);
  };
  UI.prototype.showNextCelebration = function () {
    if (this._celebrationActive || !this._celebrationQueue.length || this.blocking()) return;
    const self = this, item = this._celebrationQueue.shift(), title = item.title, sub = item.sub, color = item.color;
    const rm = CM.Settings.reducedMotion() || item.shown;
    const count = h('span', { class: 'celebrate-count', hidden: !this._celebrationQueue.length }, '另有 ' + this._celebrationQueue.length + ' 条');
    const box = h('div', { class: 'celebrate' }, h('div', { class: 'ribbon', style: { '--c': color || 'var(--accent)' } },
      h('span', { class: 'medal', 'aria-hidden': 'true' }, ic('trophy')),
      h('div', { class: 'celebrate-copy', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' }, h('div', { class: 't' }, title), sub ? h('div', { class: 's' }, sub) : null, count),
      h('button', { class: 'hbtn celebrate-close', 'aria-label': '关闭当前成就提示', title: '关闭当前提示，继续下一条', onclick: function () { self.dismissCelebration(); } }, ic('close'))));
    this._celebrationActive = { box: box, item: item, closing: false };
    if (!rm) {
      const cols = [color || '#2f6fb6', '#f0a72b', '#16a085', '#e84393', '#6c5ce7', '#e2382e'];
      for (let k = 0; k < 46; k++) {
        const p = h('i', { class: 'confetti' });
        p.style.left = (50 + (Math.random() - 0.5) * 70) + '%';
        p.style.background = cols[k % cols.length];
        p.style.setProperty('--dx', ((Math.random() - 0.5) * 260).toFixed(0) + 'px');
        p.style.setProperty('--rot', (Math.random() * 720 - 360).toFixed(0) + 'deg');
        p.style.animationDelay = (Math.random() * 0.35).toFixed(2) + 's';
        p.style.animationDuration = (1.6 + Math.random() * 1.1).toFixed(2) + 's';
        box.appendChild(p);
      }
    }
    this.fxLayer.appendChild(box);
    if (!item.shown) snd('celebrate');
    item.shown = true;
    this._celebrationTimer = setTimeout(function () { self.dismissCelebration(); }, Math.min(7000, Math.max(3800, (title.length + sub.length) * 70)));
  };

  UI.prototype.updateBanner = function () {
    const g = this.g();
    const items = g.econ.warnings().map(function (w) { return { cls: w.level, icon: 'warn', text: w.text, page: 'finance' }; });
    if (g.model.sinceChange < 1 && g.netVersion > 0) items.push({ cls: 'info', icon: 'metro', text: '新的线路网络已投入运营，居民出行选择正在重新计算…', page: null });
    if (g.econ.failed) items.unshift({ cls: 'danger', icon: 'error', text: '经营挑战已失败（点击查看）', page: 'failed' });
    const key = JSON.stringify(items);
    if (key === this._bannerKey) return;
    this._bannerKey = key;
    this.banner.innerHTML = '';
    const self = this;
    for (const it of items) this.banner.appendChild(h('div', { class: 'b ' + it.cls, onclick: function () { if (it.page === 'failed') self.showFailure(g.econ.failed); else if (it.page) self.openPage(it.page); } }, ic(it.icon), it.text));
  };

  // ======================== 提示 ========================
  const TOAST = { good: ['check', 'b-green'], bad: ['error', 'b-red'], info: ['info', 'b-blue'], warn: ['warn', 'b-orange'], money: ['coin', 'b-gold'], task: ['flag', 'b-violet'] };
  // act：可选的操作按钮 { label, fn }（如「查看报告」）；有操作的提示停留更久
  UI.prototype.toast = function (text, kind, act) {
    const k = TOAST[kind] || TOAST.info;
    const life = act ? 6500 : (kind === 'bad' ? 4500 : 3400);
    const close = function () { if (t.classList.contains('out')) return; t.classList.add('out'); setTimeout(function () { t.remove(); }, 320); };
    const t = h('div', { class: 'toast t-' + (kind || 'info') + (act ? ' has-act' : ''), onclick: close }, h('span', { class: 'badge ' + k[1] }, ic(k[0])), h('span', { class: 'tx' }, text),
      act ? h('button', { class: 'btn sm toast-act', onclick: function (e) { e.stopPropagation(); close(); act.fn(); } }, act.label) : null,
      h('i', { class: 'life', style: { animationDuration: life + 'ms' } }));
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
    if (kind === 'bad') snd('error'); else if (kind === 'good') snd('good'); else snd('notify');
    setTimeout(close, life);
  };
  UI.prototype.setTooltip = function (tip, sx, sy) {
    const el = this.tip;
    if (!tip) { el.classList.remove('on'); return; }
    // 空值（null、undefined、空串，或含 "null"/"undefined" 的拼接文字）不显示
    const ok = function (v) { return v != null && v !== '' && !/(^|[^a-z])(null|undefined|NaN)([^a-z]|$)/.test(String(v)); };
    const lines = (tip.lines || []).filter(ok), title = ok(tip.title) ? tip.title : '';
    if (!title && !lines.length) { el.classList.remove('on'); return; }
    const key = title + '|' + lines.join('|');
    if (key !== this._tipKey) {
      el.innerHTML = '';
      if (title) el.appendChild(h('div', { class: 't' }, title));
      for (const l of lines) el.appendChild(h('div', { class: 'm' }, l));
      this._tipKey = key;
    }
    el.classList.toggle('bad', !!tip.bad);
    el.classList.add('on');
    const w = el.offsetWidth, hh = el.offsetHeight;
    let x = sx + 18, y = sy + 18;
    if (x + w > window.innerWidth - 8) x = sx - w - 14;
    if (y + hh > window.innerHeight - 8) y = sy - hh - 14;
    el.style.left = x + 'px'; el.style.top = y + 'px';
  };

  // ======================== 工具坞与视图 ========================
  UI.prototype.renderToolbar = function () {
    const g = this.g(), t = this.tools ? this.tools.tool : 'select';
    for (const k of ['select', 'station', 'line', 'edit', 'demolish']) this.tbtns[k].classList.toggle('on', t === k);
    // 当前工具的滑动高亮
    const ab = this.tbtns[t];
    if (ab && ab.offsetWidth) {
      this.toolInd.style.width = ab.offsetWidth + 'px';
      this.toolInd.style.transform = 'translateX(' + ab.offsetLeft + 'px)';
      this.toolInd.classList.toggle('danger', t === 'demolish');
      this.toolInd.classList.add('ready');
    }
    const sp = g ? g.speed : 0;
    // 暂停键：运行时显示「暂停」，暂停时显示「继续」并以琥珀色提示
    const pz = this.tbtns.pause;
    if (pz._paused !== (sp === 0)) { pz._paused = sp === 0; pz.innerHTML = ''; pz.appendChild(ic(sp === 0 ? 'play' : 'pause')); pz.setAttribute('data-tip', sp === 0 ? '继续' : '暂停'); }
    pz.classList.toggle('on', sp === 0);
    this.tbtns.s1.classList.toggle('on', sp === 1);
    this.tbtns.s2.classList.toggle('on', sp === 2);
    this.tbtns.s3.classList.toggle('on', sp === 3);
    this.tbtns.d2.classList.toggle('on', this.R.cam.view === 0);
    this.tbtns.iso.classList.toggle('on', this.R.cam.view === 1);
    this.tbtns.under.classList.toggle('on', this.R.cam.tu === 1);
    this.renderToolOpts();
    if (g) this.pauseChip.classList.toggle('hidden', !(sp === 0 && !g.jumping && this.screen.classList.contains('hidden')));
  };
  UI.prototype.setSpeed = function (s) {
    const g = this.g(); if (!g || g.jumping) return;
    s = U.clamp(s, 0, CFG.time.speeds.length);
    if (g.econ.failed && s > 0) { this.toast('经营挑战已失败，请选择后续操作', 'bad'); this.showFailure(g.econ.failed); return; }
    if (s > 0) this.prevSpeed = s;
    if (s !== g.speed) snd(s === 0 ? 'pause' : 'play');
    const was = g.speed;
    g.setSpeed(s); this.renderToolbar();
    if (s === 0 && was > 0 && !this.isSaved()) this.scheduleAutosave();   // 暂停时自动保存当前进度
  };
  UI.prototype.togglePause = function () { const g = this.g(); if (!g) return; this.setSpeed(g.speed > 0 ? 0 : (this.prevSpeed || 1)); };
  UI.prototype.setView = function (iso) { if (this.R.cam.view !== (iso ? 1 : 0)) snd('swoosh'); this.R.setView(iso); this.renderToolbar(); };
  UI.prototype.toggleView = function () { this.setView(this.R.cam.view !== 1); };
  UI.prototype.toggleUnder = function () { snd('swoosh'); this.R.setUnder(this.R.cam.tu !== 1); this.renderToolbar(); };
  // 浅色 / 深色：顶栏与开始界面上的按钮直接切换（不在设置里）
  UI.prototype.toggleTheme = function () { CM.Settings.set('theme', document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); snd('toggle'); };
  UI.prototype.renderThemeBtns = function () {
    const dark = CM.Settings.resolvedTheme() === 'dark';
    for (const b of [this.hbtns && this.hbtns.theme, this.startTheme]) {
      if (!b) continue;
      b.innerHTML = ''; b.appendChild(ic(dark ? 'sun' : 'moon'));
      b.setAttribute('data-tip', dark ? '切换为浅色模式' : '切换为深色模式');
    }
  };
  UI.prototype.toggleSound = function () { CM.Settings.set('sound', !CM.Settings.get('sound')); if (CM.Settings.get('sound')) snd('toggle'); this.toast(CM.Settings.get('sound') ? '音效已开启' : '音效已关闭', 'info'); };
  UI.prototype.openStats = function (tab) { if (CM.Stats && this.g()) { this.tools.cancelDrag(); snd('open'); CM.Stats.open(this, typeof tab === 'string' ? tab : null); } };
  UI.prototype.openNetMap = function () {
    if (!CM.NetMap || !this.g()) return;
    this.tools.cancelDrag();
    if (CM.NetMap.isOpen()) { CM.NetMap.close(); return; }
    this.closeSearch(); snd('open'); CM.NetMap.open(this);
  };
  UI.prototype.jump = function (n) {
    const g = this.g(); if (!g) return;
    if (g.econ.failed) { this.showFailure(g.econ.failed); return; }
    if (!g.startJump(n)) this.toast('正在结算，请稍候', 'info');
  };
  // 切换工具：不再占用右侧面板，工具选项显示在底部工具条上方
  UI.prototype.onToolChange = function (t) {
    snd('tool');
    this.renderToolbar();
    if (this.topIs(['build']) && !this.g().draft) this.closePanel();
  };
  // 工具选项条：绘线时显示正在绘制的线路（可切换为新线路或支线）、建设方式与新站规模
  UI.prototype.renderToolOpts = function () {
    const g = this.g(), T = this.tools, el = this.toolopts;
    if (!el) return;
    if (!g || !T || T.tool === 'select') { el.classList.add('hidden'); el.innerHTML = ''; this._toKey = null; return; }
    const net = g.draft ? g.draft.net : g.net;
    const key = [T.tool, T.chain, T.lineChoice, T.buildType, T.stationSize, g.draft ? g.draft.ver : 0, g.clock.y].join('|');
    if (key === this._toKey && !el.classList.contains('hidden')) return;
    this._toKey = key;
    const self = this, mc = CFG.metro, y = g.clock.y;
    const segc = function (cur, opts, set) {
      const c = h('div', { class: 'seg-ctl sm' });
      for (const o of opts) c.appendChild(h('button', { class: cur === o[0] ? 'on' : '', 'data-tip': o[2] || null, 'data-silent': '1', onclick: function () { if (cur !== o[0]) { set(o[0]); snd('soft'); self.renderToolOpts(); } } }, o[3] ? h('span', { class: 'dot', style: { background: o[3] } }) : null, o[1]));
      return c;
    };
    const grp = function (label, ctl) { return h('div', { class: 'to-grp' }, h('span', { class: 'to-k' }, label), ctl); };
    const hint = function (icon, text) { return h('div', { class: 'to-hint' }, ic(icon), h('span', null, text)); };
    const typeCtl = grp('方式', segc(T.buildType, [['underground', '地下', '造价最高；越江为隧道，可穿越山体与保护建筑'], ['surface', '地面', '造价最低；越江为桥梁，两条地面线不能平交'], ['elevated', '高架', '造价居中；越江为桥梁']], function (v) { T.buildType = v; }));
    const sizeCtl = function (label) { return grp(label, segc(T.stationSize, ['S', 'M', 'L'].map(function (sz) { return [sz, mc.sizeName[sz].replace('型', ''), mc.sizeName[sz] + '车站：' + U.fmtInt(mc.stationCap[sz]) + ' 人次/时 · 编组上限 ' + mc.carsBySize[sz] + ' 节 · 约 ' + U.fmtMoney(M.stationCost(T.buildType, sz, y))]; }), function (v) { T.stationSize = v; })); };
    el.innerHTML = '';
    if (T.tool === 'line') {
      if (!T.chain || !net.stations[T.chain]) el.appendChild(hint('route', '点击空地开始新线路 · 点击线路端点继续延长'));
      else {
        const opts = [['new', T.lineName('new').replace('（新）', ''), '从「' + net.stations[T.chain].name + '」开始一条新线路（与已有线路换乘）', T.nextLineColor()]];
        for (const lid of M.stationLines(net, T.chain)) {
          const tp = M.lineTopo(net, lid), L = net.lines[lid];
          if (tp.topo === 'loop' || tp.topo === 'invalid') continue;
          const end = tp.adj && tp.adj.get(T.chain) && tp.adj.get(T.chain).length === 1;
          opts.push([lid, (end ? '延长 ' : '') + L.name + (end ? '' : ' 支线'), end ? '继续延长 ' + L.name : '从这里分出 ' + L.name + ' 的支线', L.color]);
        }
        if (T.lineChoice !== 'new' && net.lines[T.lineChoice] && !opts.some(function (o) { return o[0] === T.lineChoice; })) opts.push([T.lineChoice, net.lines[T.lineChoice].name, '', net.lines[T.lineChoice].color]);
        el.appendChild(grp('线路', segc(T.lineChoice, opts, function (v) { T.lineChoice = v; T.lineLock = true; })));
      }
      el.append(h('span', { class: 'to-sep' }), typeCtl, sizeCtl('新站'));
      if (T.chain) el.appendChild(h('button', { class: 'btn sm ghost', 'data-tip': '结束本次绘线', 'data-key': '右键 / Enter', onclick: function () { T.endChain(); } }, ic('check'), '完成'));
    } else if (T.tool === 'station') {
      el.append(hint('station', '点击空地建站 · 点击轨道插入车站'), h('span', { class: 'to-sep' }), typeCtl, sizeCtl('规模'));
    } else if (T.tool === 'edit') {
      el.appendChild(hint('pencil', '拖动车站或圆点调整线形 · 拖动菱形增加转弯点 · 双击删除转弯点 · Ctrl+点击多选'));
    } else if (T.tool === 'demolish') {
      el.appendChild(hint('bulldozer', '悬停查看拆除后的变化 · 点击拆除（进入草案，可撤销）'));
    }
    el.classList.remove('hidden');
  };
  // 绘线起点是多条线路的端点时：在车站旁弹出选择框，确认延长哪条线路（或改为新线路）。
  // 默认项已预选（当前选中的线路优先）；不选择而直接继续点击地图时按默认项绘制。数字键 1–9 选择，Esc 关闭
  UI.prototype.showLinePicker = function (sid, lids) {
    this.closeLinePicker();
    const g = this.g(), T = this.tools, net = g.draft ? g.draft.net : g.net, s = net.stations[sid];
    if (!s) return;
    const self = this, opts = [];
    for (const lid of lids) {
      const L = net.lines[lid], tp = M.lineTopo(net, lid);
      // 线路另一端的终点名，帮助区分方向相近的线路
      const other = (tp.leaves || []).filter(function (x) { return x !== sid; }).map(function (x) { return net.stations[x] && net.stations[x].name; }).filter(Boolean);
      opts.push({ lid: lid, color: L.color, label: '延长 ' + L.name, sub: (other.length ? '另一端：' + other.slice(0, 2).join('、') + ' · ' : '') + tp.stations.length + ' 站' });
    }
    opts.push({ lid: 'new', color: T.nextLineColor(), label: '新建线路', sub: '从「' + s.name + '」开始，与已有线路换乘' });
    const box = h('div', { class: 'line-picker glass', role: 'dialog', 'aria-label': '选择要延长的线路' },
      h('div', { class: 'lp-h' }, ic('route', 15), h('b', null, '「' + s.name + '」是 ' + lids.length + ' 条线路的端点'), h('button', { class: 'iconbtn', 'data-tip': '关闭（保留当前选择）', 'data-key': 'Esc', onclick: function () { self.closeLinePicker(); } }, ic('close', 15))),
      h('div', { class: 'lp-sub tiny muted' }, '选择要继续绘制的线路，然后点击车站或空地'));
    const btns = opts.map(function (o, i) {
      const b = h('button', { class: 'lp-opt' + (T.lineChoice === o.lid ? ' on' : ''), onclick: function () { pick(i); } },
        h('kbd', null, String(i + 1)), h('span', { class: 'lp-sw', style: { background: o.color } }), h('span', { class: 'grow' }, h('b', null, o.label), h('small', null, o.sub)), T.lineChoice === o.lid ? ic('check', 15) : null);
      box.appendChild(b);
      return b;
    });
    const pick = function (i) {
      const o = opts[i]; if (!o || T.chain !== sid) return false;
      T.lineChoice = o.lid; T.lineLock = true;
      snd('soft'); self.renderToolOpts(); self.closeLinePicker();
      self.toast(o.lid === 'new' ? '从「' + s.name + '」开始新建线路' : '从「' + s.name + '」' + o.label, 'info');
      return true;
    };
    document.body.appendChild(box);
    const R = this.R, q = R.P(s.x, s.y, 0), w = box.offsetWidth, hh = box.offsetHeight;
    let x = q.x + 22, y = q.y - hh / 2;
    if (x + w > window.innerWidth - 10) x = q.x - w - 22;
    box.style.left = U.clamp(x, 8, window.innerWidth - w - 8) + 'px';
    box.style.top = U.clamp(y, 70, window.innerHeight - hh - 90) + 'px';
    this.linePicker = { el: box, sid: sid, pick: pick, btns: btns };
  };
  UI.prototype.closeLinePicker = function () {
    if (!this.linePicker) return;
    const el = this.linePicker.el; this.linePicker = null;
    el.classList.add('out'); setTimeout(function () { el.remove(); }, 180);
  };
  UI.prototype.escape = function () {
    if (this.linePicker) { this.closeLinePicker(); return; }
    if (CM.Stats && CM.Stats.isOpen()) { CM.Stats.close(); return; }
    if (CM.NetMap && CM.NetMap.isOpen()) { CM.NetMap.close(); return; }
    if (!this.screen.classList.contains('hidden') && this.screenEsc) { this.screenEsc(); return; }
    if (this.dropdown) { this.dropdown.remove(); this.dropdown = null; return; }
    if (this.searchEl) { this.closeSearch(); return; }
    if (this.R.hl) { this.R.setHighlight(null); return; }
    if (this.multi) { this.clearMulti(); return; }
    if (this.layer !== 'none' && !this.stack.length) { this.setLayer('none'); return; }
    if (this.stack.length) { this.closePanel(); return; }
    this.select(null);
  };

  // ======================== 草案栏 ========================
  UI.prototype.renderDraftbar = function () {
    const g = this.g(); const bar = this.draftbar;
    if (!g || !g.draft) { bar.classList.add('hidden'); this._dbKey = null; return; }
    const ev = g.draftEval(), can = g.canConfirm();
    const key = g.draft.ver + '|' + can.ok + '|' + Math.round(g.econ.funds) + '|' + g.draft.pred.state + '|' + g.draft.undo.length + '|' + g.draft.redo.length;
    if (key === this._dbKey) return;
    this._dbKey = key;
    bar.classList.remove('hidden');
    bar.innerHTML = '';
    const self = this, n = ev.changes.add.length + ev.changes.mod.length + ev.changes.del.length;
    bar.append.apply(bar, [
      h('button', { class: 'db-main', 'data-tip': '查看草案详情：变更、费用与效果预测', onclick: function () { self.openPage('build', null, { root: true }); } },
        h('span', { class: 'pulse' }), h('b', null, '草案'), h('span', { class: 'muted' }, n + ' 项'), h('span', { class: 'cost' }, ic('coin'), U.fmtMoney(ev.total))),
      ev.conflicts.length ? h('button', { class: 'cfbadge', 'data-tip': '查看冲突位置与解决办法', onclick: function () { self.showConflicts(); } }, ic('error'), ev.conflicts.length + ' 处冲突') : null,
      ev.warnings.length && !ev.conflicts.length ? h('button', { class: 'cfbadge warn', 'data-tip': '查看提示', onclick: function () { self.open['dr-warn'] = true; self.openPage('build', null, { root: true }); } }, ic('warn'), ev.warnings.length) : null,
      h('span', { class: 'db-sep' }),
      h('button', { class: 'iconbtn', 'data-tip': '撤销', 'data-key': 'Ctrl+Z', onclick: function () { self.undo(); }, disabled: !g.draft.undo.length }, ic('undo')),
      h('button', { class: 'iconbtn', 'data-tip': '重做', 'data-key': 'Ctrl+Y', onclick: function () { self.redo(); }, disabled: !g.draft.redo.length }, ic('redo')),
      h('button', { class: 'btn sm ghost danger', 'data-tip': '放弃全部修改（不产生费用）', onclick: function () { self.discardDraft(); } }, '放弃'),
      h('button', { class: 'btn sm primary', 'data-tip': can.ok ? '确认后立即建成并投入运营' : can.reason, 'data-key': can.ok ? 'Ctrl+Enter' : null, disabled: !can.ok, onclick: function () { self.confirmDraft(); } }, ic('hammer'), '确认建设')
    ].filter(Boolean));
  };
  // 撤销 / 重做：按钮与快捷键共用；之后结束当前绘线，下一次点击重新选择起点
  UI.prototype.undo = function () {
    if (this.tools.cancelDrag()) return true;
    const g = this.g(); if (!g || !g.undo()) return false;
    this.tools.chain = null; this.tools.bends = [];
    return true;
  };
  UI.prototype.redo = function () {
    if (this.tools.cancelDrag()) return true;
    const g = this.g(); if (!g || !g.redo()) return false;
    this.tools.chain = null; this.tools.bends = [];
    return true;
  };
  // 草案变化后：选中对象已不存在时取消选择
  UI.prototype.syncSelection = function () {
    const g = this.g(), sel = this.selection; if (!g || !sel) return;
    const net = g.draft ? g.draft.net : g.net;
    if ((sel.kind === 'station' && !net.stations[sel.id]) || (sel.kind === 'seg' && !net.segments[sel.id])) this.selection = null;
    if (this.multi) this.pruneMulti && this.pruneMulti();
  };
  // 草案变化后刷新当前的建设、车站、线路页（控件始终反映最新草案；保留展开状态与滚动位置）
  UI.prototype.refreshObjectPage = function () {
    const top = this.stack[this.stack.length - 1];
    if (!top) return;
    if (['build', 'station', 'line', 'multi'].indexOf(top.kind) < 0) return;
    const a = document.activeElement;
    if (a && this.rBody.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) { this._pendingRefresh = true; return; }
    this.renderPage(false);
  };
  // 打开冲突列表并定位到第一处
  UI.prototype.showConflicts = function () {
    const g = this.g(); if (!g || !g.draft) return;
    const ev = g.draftEval();
    this.open['dr-conflicts'] = true;
    this.openPage('build', null, { replaceTop: true });
    if (ev.conflicts.length) { const c = ev.conflicts[0]; this.hoverConflict = c.n; this.flyTo(c.x, c.y, Math.max(this.R.cam.zoom, 20)); }
    const el = this.rBody.querySelector('.cf-list');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  UI.prototype.confirmDraft = function () {
    const g = this.g();
    // 记录新增的线路、车站与区段，用于建成反馈
    const dn = g.draft ? g.draft.net : null, on = g.net;
    const newLines = [], newSt = [], newSeg = [];
    if (dn) {
      for (const id in dn.lines) if (!on.lines[id]) newLines.push(dn.lines[id]);
      for (const id in dn.stations) if (!on.stations[id]) newSt.push(dn.stations[id]);
      for (const id in dn.segments) if (!on.segments[id]) newSeg.push(dn.segments[id]);
    }
    const r = g.confirmDraft();
    if (!r.ok) { this.toast(r.reason, 'bad'); snd('error'); return; }
    snd('build');
    const R = this.R, net = g.net;
    for (const s of newSeg) {
      const ln = net.lines[s.line]; if (!ln || !net.segments[s.id]) continue;
      try { R.addFx('trace', 0, 0, { pts: M.segGeom(net, net.segments[s.id], g.city).pts, color: ln.color }); } catch (e) { /* 几何不可用时跳过 */ }
    }
    newSt.forEach(function (s, k) { const ln = M.stationLines(net, s.id).map(function (l) { return net.lines[l]; })[0]; R.addFx('burst', s.x, s.y, { color: ln ? ln.color : '#2f6fb6', delay: 0.25 + k * 0.08 }); });
    if (newLines.length) {
      const L = newLines[0];
      const n = M.lineTopo(net, L.id).stations.length;
      this.celebrate(L.name + ' 开通运营', n + ' 座车站 · 乘客正在规划新的出行路线', L.color);
    }
    this.tools.chain = null; this.tools.bends = [];
    this.hoverConflict = null;
    this.renderDraftbar(); this.renderToolOpts();
    if (this.stack.length && this.stack[this.stack.length - 1].kind === 'build') this.rerenderPage();
  };
  UI.prototype.discardDraft = function () {
    const g = this.g(); if (!g.draft) return;
    const ev = g.draftEval();
    const self = this;
    const doIt = function () { g.cancelDraft(); self.tools.chain = null; self.tools.bends = []; self.hoverConflict = null; self.toast('已放弃草案，正式网络与资金未改变', 'info'); self.renderDraftbar(); self.rerenderPage(); };
    if (!ev.changed) { doIt(); return; }
    this.confirm('放弃建设草案？', '草案中的 ' + (ev.changes.add.length + ev.changes.mod.length + ev.changes.del.length) + ' 项修改将被丢弃，不产生任何费用。', '放弃草案', doIt, true, 'trash');
  };
  // 拆除影响预览（缓存到草案变化为止）
  UI.prototype.demolishImpact = function (t) {
    const g = this.g(); if (!g || !t) return null;
    const net = g.draft ? g.draft.net : g.net, ver = g.draft ? g.draft.ver : -1;
    const c = this._imp;
    if (c && c.net === net && c.ver === ver && c.kind === t.kind && c.id === t.id) return c.v;
    let v = null;
    if ((t.kind === 'station' && net.stations[t.id]) || (t.kind === 'seg' && net.segments[t.id])) { try { v = M.demolishImpact(net, t); } catch (e) { console.error(e); } }
    this._imp = { net: net, ver: ver, kind: t.kind, id: t.id, v: v };
    return v;
  };
  // 拆除车站或区段（进入草案），并说明实际网络变化
  UI.prototype.demolish = function (t) {
    const g = this.g(); if (!g) return;
    const net = g.draft ? g.draft.net : g.net;
    const imp = this.demolishImpact(t);
    let label = '';
    if (t.kind === 'station') { const s = net.stations[t.id]; if (!s) return; label = '车站「' + s.name + '」'; }
    else { const sg = net.segments[t.id]; if (!sg) return; label = '轨道 ' + (net.lines[sg.line] ? net.lines[sg.line].name + ' ' : '') + net.stations[sg.a].name + '—' + net.stations[sg.b].name; }
    const r = g.edit(function (n) { return { notes: t.kind === 'station' ? M.removeStation(n, t.id) : M.removeSegment(n, t.id) }; });
    if (r && r.error) { this.toast(r.error, 'bad'); return; }
    snd('demolish');
    this.toast('已在草案中拆除' + label + (imp && imp.lines.length ? '：' + imp.lines.slice(0, 3).join('；') + (imp.lines.length > 3 ? ' 等' : '') : ''), 'info');
    this.select(null);
  };
  // 执行冲突的修复建议
  UI.prototype.applyFix = function (fix) {
    const g = this.g(), net = g.draft ? g.draft.net : g.net;
    if (fix.op === 'editStation') {
      const s = net.stations[fix.station]; if (!s) return;
      this.tools.setTool('edit'); this.select({ kind: 'station', id: fix.station }, true); this.openPage('build', null, { replaceTop: true });
      this.flyTo(s.x, s.y, Math.max(this.R.cam.zoom, 26));
      this.toast('已选中「' + s.name + '」：直接拖动车站到新位置', 'info');
      return;
    }
    if (fix.op === 'editSeg') {
      const s = net.segments[fix.seg]; if (!s) return;
      this.tools.setTool('edit'); this.select({ kind: 'seg', id: fix.seg }, true); this.openPage('build', null, { replaceTop: true });
      const A = net.stations[s.a], B = net.stations[s.b];
      this.flyTo((A.x + B.x) / 2, (A.y + B.y) / 2, Math.max(this.R.cam.zoom, 22));
      this.toast('已选中该区段：拖动圆点移动转弯点，拖动菱形添加转弯点', 'info');
      return;
    }
    if (fix.op === 'restoreStation') {
      const o = g.net.stations[fix.station];
      if (!o) return;
      g.edit(function (n) { const s = n.stations[fix.station]; if (s) { s.x = o.x; s.y = o.y; s.type = o.type; } });
      this.toast('已撤回「' + o.name + '」的位置与建设方式修改', 'good');
      return;
    }
    const r = g.edit(function (n) { return M.applyFix(n, fix); });
    if (r && r.error) { this.toast(r.error, 'bad'); return; }
    if (r && r.notes) for (const n of r.notes) this.toast(n, 'info');
    this.toast('已在草案中应用：' + fix.label, 'good');
  };

  // ======================== 图层坞 ========================
  UI.prototype.renderDock = function () {
    const card = this.legendCard;
    if (card.contains(document.activeElement)) document.activeElement.blur();
    const g0 = this.g();
    for (const x of LAYERS) {
      const b = this.dockBtns[x.id];
      // need：该图层依赖的模式能力（例如地价只在经营模式可用）
      const ok = !x.need || !!(g0 && g0.econ && g0.econ.caps && g0.econ.caps[x.need]);
      b.style.display = ok ? '' : 'none';   // 用 display 而不是 .hidden：避免留下空白按钮位
      b.classList.toggle('on', this.layer === x.id);
    }
    const L = LAYERS.find((x) => x.id === this.layer);
    const hidden = !L || !g0 || (!!L.need && !(g0.econ && g0.econ.caps && g0.econ.caps[L.need]));
    card.inert = hidden; card.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    if (hidden) { card.classList.add('hidden'); this.placeFeed(); return; }
    card.innerHTML = '';
    const self = this;
    const badge = h('span', { class: 'badge lc-badge' }, ic(L.icon)); badge.style.background = L.color;
    card.append(h('div', { class: 'lc-head' }, badge, h('div', { class: 'p-title' }, L.name), h('button', { class: 'iconbtn', 'data-tip': '关闭图层', onclick: function () { self.setLayer('none'); } }, ic('close'))),
      h('div', { class: 'lc-body' }, this.legend(L.id)));
    card.classList.remove('hidden');
    this.placeFeed();
  };
  UI.prototype.setLayer = function (id) { if (id !== this.layer) snd('soft'); this.layer = id; this.R.layer = id; this.R.heatKey = ''; this.renderDock(); };
  // 图例：只保留读图所需的色标与一句说明
  UI.prototype.legend = function (id) {
    const self = this, R = this.R;
    const box = h('div', { class: 'legend' });
    const grad = function (stops, a, b) { box.append(h('div', { class: 'bar', style: { background: 'linear-gradient(90deg,' + stops.join(',') + ')' } }), h('div', { class: 'row between tiny muted' }, h('span', null, a), h('span', null, b))); };
    const li = function (col, text, kind) { box.appendChild(h('div', { class: 'li' }, h('span', { class: kind === 'line' ? 'swatch' : (kind === 'ring' ? 'dot ring' : 'dot'), style: kind === 'ring' ? { borderColor: col } : { background: col } }), text)); };
    const opts = function (key, list) {
      const ctl = h('div', { class: 'seg-ctl sm', style: { margin: '2px 0 8px' } });
      for (const o of list) ctl.appendChild(h('button', { class: R.layerOpt[key] === o[0] ? 'on' : '', 'data-silent': '1', onclick: function () { R.layerOpt[key] = o[0]; snd('soft'); self.renderDock(); } }, o[1]));
      box.appendChild(ctl);
    };
    const CC = CM.Renderer.CONG_COLS;
    let note = '';
    switch (id) {
      case 'pop': grad(['#ffe296', '#f99e4c', '#de5434'], '0', '6 万人/km²'); note = '每个街区的常住人口密度（每月更新）。'; break;
      case 'jobs': li('#f0963c', '以住宅为主'); li('#9aa0b0', '职住混合'); li('#3468d6', '以就业岗位为主'); note = '颜色越深，人口与岗位越密集。'; break;
      case 'land': {
        const st = self.g() && self.g().city.landStat;
        const fmt = function (v) { return v >= 10000 ? (v / 10000).toFixed(1) + ' 万元/㎡' : (v >= 1000 ? (v / 1000).toFixed(1) + ' 千元/㎡' : Math.round(v) + ' 元/㎡'); };
        grad(['#eee8d2', '#e2943a', '#982620'], st ? fmt(st.p10) : '低', st ? fmt(st.p90) : '高');
        li('rgba(152,38,32,0.5)', '核心区：地价高，拆迁与改造也贵');
        note = '对数色阶。地价 = 基准 × POI × 站点可达性 × 密度，每月随城市与线网更新；只在经营模式可用。';
        break;
      }
      case 'cong': li(CC[0], '畅通', 'line'); li(CC[1], '缓行', 'line'); li(CC[2], '拥堵', 'line'); li(CC[3], '严重拥堵', 'line'); note = '主要道路（快速路与主干道）当前时刻的拥堵程度（流量 ÷ 通行能力），随早晚高峰实时变化，夜间与平峰多为畅通；线越粗道路等级越高。'; break;
      case 'flow': opts('flow', [['all', '全部'], ['car', '汽车'], ['metro', '地铁']]); if (R.layerOpt.flow === 'all') { li('#80869a', '汽车出行', 'line'); li('#2166cc', '其中乘地铁（箭头中间的蓝色部分）', 'line'); } note = '每个片区当前时段最主要的出行方向（第二方向接近时也画出）：箭头从片区指向目的地，尖端标出目的地名称；两个片区互为主要方向时画成双向箭头。线越粗出行越多，新区域开放、修建地铁后会随之变化。'; break;
      case 'cover': opts('cover', [['time', '步行时间'], ['station', '所属车站']]);
        if (R.layerOpt.cover === 'station') { li('rgba(20,162,82,0.5)', '每个颜色块为步行最近的车站（细线为分界）'); li('#d73027', '人口密集但无地铁'); }
        else { li('#1b7837', '步行 5 分钟内'); li('#5aae61', '步行 10 分钟内'); li('#acdc8c', '步行 15 分钟内'); li('#d73027', '人口密集但无地铁'); }
        li('#c0392b', '地面铁路（无道口、地道或天桥处阻隔步行）', 'line');
        note = '沿实际道路计算：河流、断路与没有通道的地面铁路会阻隔，绕行会拉长步行时间。选中车站可以查看它的步行范围。'; break;
      case 'station': opts('stView', [['flow', '全日客流'], ['load', '高峰负荷']]); opts('stDt', [['avg', '周平均'], ['wd', '工作日'], ['we', '周末']]);
        if (R.layerOpt.stView === 'load') { li('#2fa36b', '高峰小时满载率 < 60%', 'line'); li('#e8a33a', '60%–100%', 'line'); li('#d93a3a', '超过 100%（拥挤）', 'line'); li('rgba(217,58,58,0.85)', '车站高峰负荷超过能力'); note = '高峰负荷：区间断面客流 ÷ 线路运力（发车频率 × 列车定员，系统按客流自动加车，最小间隔 2 分钟）；车站为进出站与换乘人数 ÷ 车站能力。'; }
        else { opts('station', [['all', '合计'], ['in', '进站'], ['out', '出站'], ['xfer', '换乘']]); li('rgba(31,143,191,0.8)', '高峰负荷正常（< 60%）'); li('rgba(240,160,32,0.85)', '负荷较高（60%–100%）'); li('rgba(217,58,58,0.85)', '超过车站能力'); note = '全日：圆越大客流越大，颜色为高峰小时负荷；线路下方的色带为区间断面客流。'; }
        note = (self.g() && self.g().model.stDaily && self.g().compiled.routes.length ? '' : '还没有运营线路或客流仍在计算。') + note + ' 统计口径：' + { avg: '周平均（5 个工作日 + 2 个周末日）', wd: '工作日', we: '周末' }[R.layerOpt.stDt] + '。'; break;
      case 'fac': {
        opts('facP', [['all', '设施类'], ['sc', '上学'], ['sh', '购物'], ['md', '医疗'], ['lz', '休闲'], ['hb', '枢纽'], ['hw', '通勤']]);
        opts('facDt', [['wd', '工作日'], ['we', '周末']]);
        const TR = CFG.trips;
        if (R.layerOpt.facP === 'all') { for (const k of ['sc', 'sh', 'md', 'lz']) li(TR.color[k], TR.name[k] + '为主的片区'); }
        else li(TR.color[R.layerOpt.facP], TR.name[R.layerOpt.facP] + '吸引（片区汇总）');
        li('#7a8699', '圆点：重要设施（大小为日到访量，外环越绿乘地铁比例越高）', 'ring');
        note = '片区颜色为普通设施（中小学、社区商业、诊所、街区公园等）按片区汇总的吸引出行；重要设施单独计算，点击圆点查看详情。设施位置与年份为史实参考，规模为估算，到访量为模拟结果（汽车 + 地铁出行，不含步行）。';
        break;
      }
      case 'gap': opts('gapDt', [['wd', '工作日'], ['we', '周末']]);
        li('#c62828', '出行多，但步行 15 分钟内没有地铁站'); li('#ef8a3a', '已有地铁，但车站或区间高峰超载'); li('#7a1f1f', '重要设施：步行 15 分钟内没有地铁站', 'ring');
        note = '缺口 = 片区出发与到达的出行量 ×（1 − 地铁步行覆盖比例），按面积折算；颜色越深缺口越大。超载按高峰小时计。';
        break;
    }
    box.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, note));
    return box;
  };

  // ======================== 右侧面板（页面栈） ========================
  UI.prototype.openTop = function (key) {
    const top = this.stack[this.stack.length - 1], open = !!top && !this.right.classList.contains('closed');
    if (key === 'date') this.openPage('date', null, { toggle: true, root: true });
    // 资金与经济：同一个面板的不同分页。面板已打开时再次点击同一入口收起，点击另一入口切换分页
    else if (key === 'money' || key === 'econ') {
      const want = key === 'econ' ? 'econ' : 'ov';
      if (open && top.kind === 'finance' && ((want === 'econ') === (top.id === 'econ'))) { this.closePanel(); return; }
      this.finTab = want;
      this.openPage('finance', want, { root: true });
    }
    else if (key === 'tasks') {
      if (open && top.kind === 'tasks') { this.closePanel(); return; }
      this.taskTab = 'active';
      this.openPage('tasks', 'active', { root: true });
    }
    else if (key === 'save') this.openPage('saves', null, { toggle: true, root: true });
    else this.openPage('metric', key, { toggle: true, root: true });
  };
  UI.prototype.openPage = function (kind, id, opts) {
    opts = opts || {};
    const top = this.stack[this.stack.length - 1];
    if (top && top.kind === kind && top.id === id && !this.right.classList.contains('closed')) { if (opts.toggle) this.closePanel(); else this.renderPage(false); return; }
    if (opts.replaceTop && top) this.stack[this.stack.length - 1] = { kind: kind, id: id };
    else if (opts.root) this.stack = [{ kind: kind, id: id }];
    else { this.stack.push({ kind: kind, id: id }); if (this.stack.length > 8) this.stack.shift(); }
    snd('open');
    this.renderPage(true);
  };
  UI.prototype.back = function () {
    if (this.topIs(['multi'])) this.multi = null;
    if (this.stack.length > 1) { this.stack.pop(); this.renderPage(true); }
    else this.closePanel();
  };
  UI.prototype.closePanel = function (silent) {
    if (!silent && this.stack.length) snd('close');
    this.stack = []; this.live = []; this.multi = null;
    if (this.right.contains(document.activeElement)) document.activeElement.blur();
    this.right.inert = true;
    this.right.setAttribute('aria-hidden', 'true');
    this.right.classList.add('closed');
    if (!silent && this.selection && this.selection.kind !== 'station') this.select(null, true);
    this.highlightLine = null;
    this.placeFeed();
  };
  UI.prototype.rerenderPage = function () { if (this.stack.length) this.renderPage(false); };
  UI.prototype.refreshBuild = function () {
    const top = this.stack[this.stack.length - 1];
    if (top && top.kind === 'build') this.renderPage(false);
  };
  UI.prototype.refreshPrediction = function () {
    const top = this.stack[this.stack.length - 1];
    if (!top || top.kind !== 'build' || !this.predBox) return;
    const n = this.predictionBlock();
    this.predBox.replaceWith(n); this.predBox = n;
  };
  UI.prototype.renderPage = function (anim) {
    const top = this.stack[this.stack.length - 1];
    if (!top || !this.g()) { this.closePanel(true); return; }
    this.live = [];
    // 网络刚变化、车站客流尚未按新网络统计时渲染的页面：统计完成后自动重绘一次（见 tick）
    this.pageDailyStale = !!this.g().model.dailyStale;
    const scroll = anim ? 0 : this.rBody.scrollTop;
    let page;
    try { page = this['page_' + top.kind](top.id); }
    catch (e) { console.error(e); page = { title: '详情', el: h('div', { class: 'callout bad' }, '无法显示：' + e.message) }; }
    if (!page) { this.back(); return; }
    this.rTitle.textContent = page.title;
    const pi = top.kind === 'metric' ? (METRIC_ICON[top.id] || PAGE_ICON.metric) : (PAGE_ICON[top.kind] || ['info', 'b-slate']);
    this.rBadge.className = 'badge ' + pi[1];
    this.rBadge.innerHTML = ''; this.rBadge.appendChild(ic(pi[0]));
    if (top.kind === 'line' && page.highlightLine) { const ln = (this.g().draft ? this.g().draft.net : this.g().net).lines[page.highlightLine]; if (ln) { this.rBadge.className = 'badge'; this.rBadge.style.background = ln.color; } }
    else this.rBadge.style.background = '';
    this.rBack.style.visibility = this.stack.length > 1 ? 'visible' : 'hidden';
    this.rBody.innerHTML = '';
    if (anim) page.el.classList.add('page-enter');
    this.rBody.appendChild(page.el);
    this.rBody.scrollTop = scroll;
    const wasClosed = this.right.classList.contains('closed');
    this.right.inert = false;
    this.right.setAttribute('aria-hidden', 'false');
    this.right.classList.remove('closed');
    if (wasClosed) this.placeFeed();
    this.highlightLine = page.highlightLine || null;
  };
  UI.prototype.sec = function (key, title, summary, bodyFn, defOpen, icon) {
    const open = this.open[key] !== undefined ? this.open[key] : !!defOpen;
    const wrap = h('div', { class: 'sec' + (open ? ' open' : '') });
    const head = h('button', { class: 'sec-h', 'aria-expanded': open ? 'true' : 'false', 'data-silent': '1' }, icon ? ic(icon) : null, h('span', null, title), summary ? h('span', { class: 'sum' }, summary) : null, ic('chev', 14, 'chev'));
    const body = h('div', { class: 'sec-b', inert: !open, 'aria-hidden': open ? 'false' : 'true' }), inner = h('div', { class: 'inner' });
    body.appendChild(inner);
    let built = false;
    const build = function () { if (!built) { built = true; const c = bodyFn(); if (c) inner.appendChild(c); } };
    if (open) { build(); body.style.height = 'auto'; }
    const self = this;
    head.addEventListener('click', function () {
      const isOpen = wrap.classList.contains('open');
      if (isOpen && body.contains(document.activeElement)) head.focus();
      body.inert = isOpen; body.setAttribute('aria-hidden', isOpen ? 'true' : 'false');
      snd(isOpen ? 'close' : 'open');
      if (isOpen) {
        body.style.height = body.scrollHeight + 'px';
        void body.offsetHeight;
        wrap.classList.remove('open'); body.style.height = '0px';
      } else {
        build();
        wrap.classList.add('open'); body.style.height = '0px';
        void body.offsetHeight;
        body.style.height = inner.scrollHeight + 'px';
        const te = function () { if (wrap.classList.contains('open')) body.style.height = 'auto'; body.removeEventListener('transitionend', te); };
        body.addEventListener('transitionend', te);
      }
      head.setAttribute('aria-expanded', isOpen ? 'false' : 'true');
      self.open[key] = !isOpen;
    });
    wrap.append(head, body);
    return wrap;
  };
  UI.prototype.kv = function (rows) {
    const el = h('div', { class: 'kv' });
    for (const r of rows) { if (!r) continue; el.append(h('div', { class: 'k' }, r[0]), h('div', { class: 'v' + (r[2] ? ' ' + r[2] : '') }, r[1])); }
    return el;
  };
  UI.prototype.stat = function (k, v, d, dcls, icon) {
    const vv = h('div', { class: 'v' }, v), dd = h('div', { class: 'd ' + (dcls || 'muted') }, d || '');
    const el = h('div', { class: 'stat' }, h('div', { class: 'k' }, icon ? ic(icon) : null, k), vv, dd);
    el.setV = function (x, y, c) { vv.textContent = x; if (y !== undefined) dd.textContent = y; if (c !== undefined) dd.className = 'd ' + c; };
    return el;
  };
  UI.prototype.liveText = function (fn, cls) {
    const el = h('span', { class: cls || '' }, '');
    const upd = function () { el.textContent = fn(); };
    upd(); this.live.push(upd);
    return el;
  };
  UI.prototype.callout = function (kind, icon, content) { return h('div', { class: 'callout ' + kind }, ic(icon), h('div', { class: 'ct' }, content)); };

  // ======================== 选择 ========================
  // 上盖开发：进入草案（与升级车站同一路径，费用在草案里核算，确认建设后才扣款）
  UI.prototype.devStation = function (id, lv) {
    const g = this.g();
    if (!g || g.draft) return;
    const y = g.clock.y, m = g.clock.m;
    const r = g.edit(function (n) {
      const s = n.stations[id];
      if (!s) return { error: '车站不存在' };
      s.dev = lv;
      s.devAt = [y, m];
      return null;
    });
    if (r && r.error) { this.toast(r.error, 'bad'); return; }
    this.rerenderPage();
  };

  UI.prototype.select = function (sel, noPage) {
    this.selection = sel;
    if (!sel) { this.highlightLine = null; if (!noPage && this.stack.length && ['station', 'line', 'road', 'zone', 'facility'].indexOf(this.stack[this.stack.length - 1].kind) >= 0) this.back(); return; }
    if (noPage) return;
    const g = this.g();
    const inBuild = this.tools.tool !== 'select';
    if (sel.kind === 'station') this.openPage('station', sel.id, { replaceTop: this.topIs(['station', 'line', 'road', 'zone', 'facility']) || inBuild });
    else if (sel.kind === 'seg') {
      const net = g.draft ? g.draft.net : g.net;
      const s = net.segments[sel.id];
      if (s) this.openPage('line', s.line + '|' + sel.id, { replaceTop: this.topIs(['station', 'line', 'road', 'zone', 'facility']) || inBuild });
    } else if (sel.kind === 'road') this.openPage('road', sel.id, { replaceTop: this.topIs(['station', 'line', 'road', 'zone', 'facility']) });
    else if (sel.kind === 'zone') this.openPage('zone', sel.id, { replaceTop: this.topIs(['station', 'line', 'road', 'zone', 'facility']) });
    else if (sel.kind === 'facility') this.openPage('facility', sel.id, { replaceTop: this.topIs(['station', 'line', 'road', 'zone', 'facility']) });
  };
  // ---------------- 多选（批量修改） ----------------
  UI.prototype.setMulti = function (sel) {
    this.multi = { stations: new Set(sel.stations || []), segs: new Set(sel.segs || []) };
    this.pruneMulti();
    if (this.multi) this.openPage('multi', null, { replaceTop: this.topIs(['station', 'line', 'road', 'zone', 'facility', 'multi']) });
  };
  UI.prototype.toggleMulti = function (kind, id) {
    if (!this.multi) {
      this.multi = { stations: new Set(), segs: new Set() };
      // 已选中的单个对象作为多选的第一项
      const s = this.selection;
      if (s && s.kind === 'station') this.multi.stations.add(s.id);
      if (s && s.kind === 'seg') this.multi.segs.add(s.id);
    }
    const set = kind === 'station' ? this.multi.stations : this.multi.segs;
    if (set.has(id)) set.delete(id); else set.add(id);
    snd('soft');
    this.pruneMulti();
    if (this.multi) { if (this.topIs(['multi'])) this.renderPage(false); else this.openPage('multi', null, { replaceTop: this.topIs(['station', 'line', 'road', 'zone', 'facility']) }); }
  };
  UI.prototype.pruneMulti = function () {
    const g = this.g(), mu = this.multi; if (!mu || !g) return;
    const net = g.draft ? g.draft.net : g.net;
    mu.stations.forEach(function (id) { if (!net.stations[id]) mu.stations.delete(id); });
    mu.segs.forEach(function (id) { if (!net.segments[id]) mu.segs.delete(id); });
    if (!mu.stations.size && !mu.segs.size) { this.multi = null; if (this.topIs(['multi'])) this.back(); }
  };
  UI.prototype.clearMulti = function () { this.multi = null; if (this.topIs(['multi'])) this.back(); };
  UI.prototype.topIs = function (kinds) { const t = this.stack[this.stack.length - 1]; return !!t && kinds.indexOf(t.kind) >= 0; };
  UI.prototype.flyTo = function (x, y, z) { this.R.flyTo(x, y, z || Math.max(this.R.cam.zoom, 22)); };

  // ======================== 页面：建设 ========================
  UI.prototype.page_build = function () {
    const g = this.g(), self = this;
    const el = h('div');
    if (!g.draft) {
      el.appendChild(h('div', { class: 'note' }, '还没有建设草案。用底部的「建站」「绘线」等工具开始规划；草案确认前不会扣费，也不会改变正式网络。'));
      return { title: '建设草案', el: el };
    }
    const ev = g.draftEval();
    if (ev.conflicts.length) el.appendChild(this.conflictBlock(ev));
    else if (ev.changed) el.appendChild(this.callout('good', 'good', '没有冲突，可以确认建设。'));
    const nAdd = ev.changes.add.length, nMod = ev.changes.mod.length, nDel = ev.changes.del.length;
    el.appendChild(this.sec('dr-changes', '变更内容', nAdd + ' 新建 · ' + nMod + ' 修改 · ' + nDel + ' 拆除', function () {
      const box = h('div');
      const sect = function (title, arr, cls) { if (!arr.length) return; box.appendChild(h('div', { class: 'small ' + cls, style: { margin: '6px 0 2px', fontWeight: 600 } }, title)); for (const t of arr) box.appendChild(h('div', { class: 'small', style: { padding: '2px 0' } }, '· ' + t)); };
      sect('新建', ev.changes.add, 'good'); sect('修改', ev.changes.mod, 'warn'); sect('拆除', ev.changes.del, 'bad');
      if (!nAdd && !nMod && !nDel) box.appendChild(h('div', { class: 'note' }, '草案暂无变化。'));
      return box;
    }, true, 'tasks'));
    el.appendChild(this.sec('dr-cost', '费用', U.fmtMoney(ev.total), function () {
      const box = h('div');
      for (const it of ev.items) box.appendChild(h('div', { class: 'chg small' }, h('span', null, it.label), h('span', { class: 'num' }, U.fmtMoney(it.amount))));
      if (!ev.items.length) box.appendChild(h('div', { class: 'note' }, '本次修改不产生费用（拆除与小范围调整免费）。'));
      box.appendChild(h('div', { class: 'note', style: { marginTop: '6px' } }, g.econ.isFree() ? '自由建造：资金不限。' : '当前资金 ' + U.fmtMoney(g.econ.funds) + '。'));
      return box;
    }, false, 'coin'));
    if (ev.warnings.length) {
      el.appendChild(this.sec('dr-warn', '提示', ev.warnings.length + ' 条', function () {
        const box = h('div');
        for (const w of ev.warnings) box.appendChild(h('div', { class: 'wn-card', onclick: function () { self.flyTo(w.x, w.y); } }, ic('warn'), h('span', null, w.msg)));
        return box;
      }, false, 'warn'));
    }
    this.predBox = this.predictionBlock();
    el.appendChild(this.predBox);
    return { title: '建设草案', el: el };
  };
  // 车站规模卡片：容量、编组上限、建设费、日运营费。
  // opts：{ type, cur（当前选择）, base（既有车站的已建规模，新建时为空）, rebuild（建设方式已改，按改建计费）, onPick }
  UI.prototype.sizeCards = function (opts) {
    const g = this.g(), y = g.clock.y, mc = CFG.metro, oi = g.econ.opsIndex(y), ord = ['S', 'M', 'L'];
    const wrap = h('div');
    const cards = h('div', { class: 'size-cards' });
    const costOf = function (sz) { return M.stationCost(opts.type, sz, y); };
    const upCost = function (sz) { return (costOf(sz) - costOf(opts.base)) * CFG.cost.upgradeFactor; };
    for (const sz of ord) {
      let line;
      if (!opts.base || opts.rebuild) line = (opts.rebuild ? '改建 ' : '建设 ') + U.fmtMoney(costOf(sz));
      else {
        const d = ord.indexOf(sz) - ord.indexOf(opts.base);
        line = d === 0 ? '已建规模' : (d > 0 ? '升级 ' + U.fmtMoney(upCost(sz)) : '缩减 · 不退款');
      }
      cards.appendChild(h('button', { class: 'size-card' + (opts.cur === sz ? ' on' : ''), 'aria-pressed': opts.cur === sz ? 'true' : 'false', onclick: function () { if (opts.cur !== sz) opts.onPick(sz); } },
        h('div', { class: 'sc-h' }, h('b', null, mc.sizeName[sz]), opts.base === sz ? h('span', { class: 'sc-tag' }, '当前') : null),
        h('div', { class: 'sc-v' }, U.fmtInt(mc.stationCap[sz]), h('small', null, ' 人次/时')),
        h('div', { class: 'sc-k' }, '编组上限 ' + mc.carsBySize[sz] + ' 节'),
        h('div', { class: 'sc-k' }, '运营 ' + U.fmtMoney(CFG.ops.stationDaily[sz] * oi) + '/日'),
        h('div', { class: 'sc-cost' }, line)));
    }
    wrap.appendChild(cards);
    // 升级前后对比与本次费用
    if (opts.base && opts.cur !== opts.base && !opts.rebuild) {
      const a = opts.base, b = opts.cur, up = ord.indexOf(b) > ord.indexOf(a);
      const dOps = (CFG.ops.stationDaily[b] - CFG.ops.stationDaily[a]) * oi;
      wrap.appendChild(h('div', { class: 'size-diff ' + (up ? 'up' : 'down') },
        h('div', null, h('b', null, mc.sizeName[a] + ' → ' + mc.sizeName[b]), up ? '，本次升级费用 ' + U.fmtMoney(upCost(b)) : '，缩减不退还建设费'),
        h('div', { class: 'tiny' }, '容量 ' + U.fmtInt(mc.stationCap[a]) + ' → ' + U.fmtInt(mc.stationCap[b]) + ' 人次/时 · 编组上限 ' + mc.carsBySize[a] + ' → ' + mc.carsBySize[b] + ' 节 · 运营费 ' + (dOps >= 0 ? '+' : '−') + U.fmtMoney(Math.abs(dOps)) + '/日')));
    }
    return wrap;
  };
  // 冲突列表：编号与地图图钉一致，说明原因、怎么解决，并提供一键修复
  UI.prototype.conflictBlock = function (ev) {
    const self = this;
    const wrap = h('div');
    wrap.appendChild(this.callout('bad', 'error', h('span', null, h('b', null, '有 ' + ev.conflicts.length + ' 处冲突，需解决后才能确认建设。'), h('br'), '地图上的红色编号图钉标出了每处冲突的位置，相关轨道或车站以红色高亮。')));
    const list = h('div', { class: 'cf-list' });
    for (const c of ev.conflicts) {
      const fixes = h('div', { class: 'cf-fix' });
      fixes.appendChild(h('button', { class: 'btn sm', onclick: function (e) { e.stopPropagation(); self.hoverConflict = c.n; self.flyTo(c.x, c.y, Math.max(self.R.cam.zoom, 22)); } }, ic('locate'), '定位'));
      for (const f of (c.fixes || [])) fixes.appendChild(h('button', { class: 'btn sm' + (f.op === 'segType' || f.op === 'splitBranch' || f.op === 'normalize' || f.op === 'removeBend' ? ' primary' : ''), onclick: function (e) { e.stopPropagation(); self.applyFix(f); } }, f.label));
      const card = h('div', { class: 'cf-card' + (self.hoverConflict === c.n ? ' on' : ''),
        onmouseenter: function () { self.hoverConflict = c.n; },
        onmouseleave: function () { if (self.hoverConflict === c.n) self.hoverConflict = null; },
        onclick: function () { self.hoverConflict = c.n; self.flyTo(c.x, c.y, Math.max(self.R.cam.zoom, 20)); } },
        h('div', { class: 'cf-top' }, h('span', { class: 'cf-num' }, String(c.n)), h('div', { class: 'cf-msg' }, c.msg)),
        c.how ? h('div', { class: 'cf-how' }, h('b', null, '怎么解决：'), c.how) : null,
        fixes);
      list.appendChild(card);
    }
    wrap.appendChild(list);
    return wrap;
  };

  // ======================== 菜单与全屏界面 ========================
  UI.prototype.showMenu = function (anchor) {
    const self = this;
    if (this.dropdown) { this.dropdown.remove(); this.dropdown = null; return; }
    const item = function (icon, label, fn, key) { return h('button', { onclick: function () { self.dropdown.remove(); self.dropdown = null; fn(); } }, ic(icon), h('span', { class: 'grow' }, label), key ? h('kbd', null, key) : null); };
    const narrowItem = function (icon, label, fn) { const b = item(icon, label, fn); b.classList.add('dd-narrow'); return b; };
    const g = this.g();
    const dd = h('div', { class: 'dropdown' },
      h('div', { class: 'dd-head' }, h('img', { src: 'img/logo-white.png', alt: '' }), h('div', null, h('b', null, g ? g.name : '城市与地铁'), h('div', { class: 'tiny muted' }, g ? (g.econ.isFree() ? '自由建造' : '经营挑战') + ' · ' + g.clock.y + '年' + g.clock.m + '月' : ''), g ? h('div', { class: 'tiny ' + (self.save.state === 'error' ? 'bad' : (self.isSaved() ? 'good' : 'muted')) }, self.saveStatusText()) : null)),
      item('save', '保存进度', function () { self.manualSave(); }),
      item('folder', '读取存档', function () { self.showSaveManager(true); }),
      h('hr'),
      g && CM.DATA.briefing ? item('briefing', '开局简报', function () { self.showBriefing(); }) : null,
      g ? item('book', '城市纪事', function () { self.openStats('milestones'); }) : null,
      item('help', '操作说明', function () { self.openPage('help', null, { root: true }); }),
      item('megaphone', '更新公告', function () { self.showNews(); }),
      // 窄屏（手机）顶栏收起了深浅模式与设置按钮，在菜单里提供
      narrowItem(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon', document.documentElement.dataset.theme === 'dark' ? '浅色模式' : '深色模式', function () { self.toggleTheme(); }),
      narrowItem('gear', '设置', function () { self.showSettings(); }),
      h('hr'),
      item('home', '返回主菜单', function () { self.backToMenu(); }));
    document.body.appendChild(dd);
    this.dropdown = dd;
    // 矮窗口内保留菜单自身的滚动区域；窗口或界面缩放后重新跟随菜单按钮定位。
    dd._place = function () {
      const r = anchor.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
      const top = Math.max(8, Math.min(r.bottom + 8, vh / 2));
      dd.style.top = top + 'px';
      dd.style.maxHeight = Math.max(0, vh - top - 8) + 'px';
      const x = r.left < vw / 2 ? r.left : r.right - dd.offsetWidth;
      dd.style.left = Math.max(8, Math.min(x, vw - dd.offsetWidth - 8)) + 'px';
    };
    dd._place();
    setTimeout(function () {
      const close = function (e) { if (self.dropdown && !self.dropdown.contains(e.target)) { self.dropdown.remove(); self.dropdown = null; } window.removeEventListener('pointerdown', close, true); };
      window.addEventListener('pointerdown', close, true);
    }, 0);
  };

  // ======================== 收藏与搜索 ========================
  // 收藏按 id 引用实际站点或线路（改名自动同步）；同时记住最后的名称，用于说明已拆除的收藏
  UI.prototype.isFav = function (kind, id) { const g = this.g(); return !!g && g.favs[kind].indexOf(id) >= 0; };
  UI.prototype.toggleFav = function (kind, id) {
    const g = this.g(); if (!g) return;
    const a = g.favs[kind], i = a.indexOf(id);
    if (i >= 0) a.splice(i, 1);
    else {
      a.push(id);
      const net = g.draft ? g.draft.net : g.net, o = kind === 'stations' ? net.stations[id] : net.lines[id];
      g.favs.names = g.favs.names || {}; if (o) g.favs.names[id] = o.name;
    }
    g.touch(); this.markUnsaved(); snd('soft');
  };
  UI.prototype.favBtn = function (kind, id) {
    const self = this;
    const b = h('button', { class: 'iconbtn fav', onclick: function () { self.toggleFav(kind, id); upd(); } });
    const upd = function () { const on = self.isFav(kind, id); b.classList.toggle('on', on); b.innerHTML = ''; b.appendChild(ic(on ? 'starOn' : 'star')); b.setAttribute('data-tip', on ? '取消收藏' : '收藏（在搜索中置顶）'); };
    upd();
    return b;
  };
  // 定位一组车站（线路）：飞到其范围
  UI.prototype.flyToStations = function (pts) {
    if (!pts.length) return;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const z = U.clamp(Math.min(this.R.w * 0.55 / (x1 - x0 + 2), this.R.h * 0.55 / (y1 - y0 + 2)), 8, 30);
    this.R.flyTo((x0 + x1) / 2, (y0 + y1) / 2, z);
  };
  // ---------------- 在地图上定位并高亮（片区、区域、道路、地点） ----------------
  // 地图上未被遮挡的区域（除去左侧图层栏、右侧详情面板、顶栏与底部工具栏）
  UI.prototype.mapViewport = function () {
    let x0 = 0, x1 = this.R.w, y0 = 0, y1 = this.R.h;
    const box = function (id) { const el = document.getElementById(id); return el && !el.classList.contains('hidden') && el.offsetWidth > 0 ? el.getBoundingClientRect() : null; };
    const rp = box('rightPanel'), dk = box('dock'), tp = box('hudTop'), tb = box('toolbar');
    if (rp && rp.left > this.R.w * 0.3) x1 = rp.left - 8;
    if (dk) x0 = dk.right + 8;
    if (tp) y0 = tp.bottom + 8;
    if (tb && tb.top > this.R.h * 0.5) y1 = tb.top - 8;
    return { x0: x0, y0: y0, x1: x1, y1: y1 };
  };
  // 飞到一个范围并让它落在可见区域中央（略偏下，给上方的名称标签留位置）
  UI.prototype.fitBox = function (x0, y0, x1, y1, maxZ) {
    const R = this.R, M = R.M, vp = this.mapViewport();
    let sx0 = 1e9, sx1 = -1e9, sy0 = 1e9, sy1 = -1e9;
    for (const c of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
      const sx = M[0] * c[0] + M[1] * c[1], sy = M[2] * c[0] + M[3] * c[1];
      sx0 = Math.min(sx0, sx); sx1 = Math.max(sx1, sx); sy0 = Math.min(sy0, sy); sy1 = Math.max(sy1, sy);
    }
    const z = U.clamp(Math.min((vp.x1 - vp.x0) * 0.7 / (sx1 - sx0 + 1), (vp.y1 - vp.y0 - 50) * 0.75 / (sy1 - sy0 + 1)), 7, maxZ || 30);
    const dx = R.w / 2 - (vp.x0 + vp.x1) / 2, dy = R.h / 2 - ((vp.y0 + vp.y1) / 2 + 18), det = M[0] * M[3] - M[1] * M[2] || 1;
    R.flyTo((x0 + x1) / 2 + (M[3] * dx - M[1] * dy) / det / z, (y0 + y1) / 2 + (M[0] * dy - M[2] * dx) / det / z, z);
  };
  UI.prototype.locateZone = function (z, label) {
    const g = this.g(), m = g.model, Z = CFG.ZONE, zi = z % m.ZW, zj = (z / m.ZW) | 0;
    const x0 = zi * Z, y0 = zj * Z;
    this.R.setHighlight({ kind: 'rect', x0: x0, y0: y0, x1: x0 + Z, y1: y0 + Z, lx: x0 + Z / 2, ly: y0, label: label || g.zoneName(z) });
    this.fitBox(x0 - 2, y0 - 2, x0 + Z + 2, y0 + Z + 2, 26);
  };
  UI.prototype.locatePoint = function (x, y, label, r, pad) {
    r = r || 1.2; pad = pad || 2;
    this.R.setHighlight({ kind: 'circle', x: x, y: y, r: r, lx: x, ly: y - r, label: label });
    this.fitBox(x - r - pad, y - r - pad, x + r + pad, y + r + pad, 26);
  };
  UI.prototype.locateRegion = function (k) {
    const g = this.g(), rg = g.city.regions[k]; if (!rg || !rg.bbox) return;
    const b = rg.bbox;
    this.R.setHighlight({ kind: 'region', region: k, lx: rg.cx, ly: rg.cy, label: rg.name.replace(/（.*）/, '') });
    this.fitBox(b[0], b[1], b[2], b[3], 22);
  };
  UI.prototype.locateRoad = function (name) {
    const city = this.g().city, ways = [];
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    city.roadGroups.forEach(function (gr) { if (gr.name !== name) return; for (const p of gr.ways) ways.push(p); x0 = Math.min(x0, gr.bbox[0]); y0 = Math.min(y0, gr.bbox[1]); x1 = Math.max(x1, gr.bbox[2]); y1 = Math.max(y1, gr.bbox[3]); });
    if (!ways.length) return;
    const p = ways[0], m = (p.length / 4 | 0) * 2;
    this.R.setHighlight({ kind: 'road', ways: ways, lx: p[m], ly: p[m + 1], label: name });
    this.fitBox(x0, y0, x1, y1, 24);
  };
  UI.prototype.openSearch = function () {
    const g = this.g(); if (!g) return;
    if (this.searchEl) { this.closeSearch(); return; }
    if (this.dropdown) { this.dropdown.remove(); this.dropdown = null; }
    const self = this, favs = g.favs, city = g.city, D = CM.DATA;
    favs.names = favs.names || {};
    const input = h('input', { type: 'search', placeholder: '搜索车站、线路、道路、区域或地名', 'aria-label': '搜索车站、线路、道路、区域或地名', autocomplete: 'off' });
    const list = h('div', { class: 'srch-list', role: 'listbox' });
    const pop = h('div', { class: 'search-pop' }, h('div', { class: 'srch-in' }, ic('search'), input, h('kbd', null, 'Esc')), list);
    const r = this.hbtns.search.getBoundingClientRect();
    pop.style.top = (r.bottom + 8) + 'px'; pop.style.right = Math.max(8, window.innerWidth - r.right - 40) + 'px';
    let items = [], cur = 0;
    // 地理条目（区域、城区、地标、道路、地名）：打开时生成一次
    const RANK = { lines: 0, stations: 1, region: 2, district: 2, landmark: 3, road: 4, place: 5 };
    const geo = [];
    city.regions.forEach(function (rg, k) {
      if (!rg.name || !rg.cells || !rg.bbox) return;
      geo.push({ kind: 'region', id: k, name: rg.name, sub: '区域 · ' + (rg.scenic ? '风景区' : city.regionOpen[k] ? '已开放' : '尚未开放（' + U.regionLock(rg) + '）'), icon: 'map' });
    });
    for (const d of city.districtLabels || []) geo.push({ kind: 'district', name: d[0], sub: '城区', x: d[1], y: d[2], icon: 'map' });
    D.landmarks.forEach(function (lm, k) { geo.push({ kind: 'landmark', name: lm.name, sub: '地标' + (city.landmarkOn[k] ? '' : ' · 尚未建成（' + lm.year + ' 年）'), x: lm.x, y: lm.y, icon: 'building' }); });
    const roads = new Map(), CLS = ['', '支路', '次干道', '主干道', '快速路'];
    city.roadGroups.forEach(function (gr, k) {
      if (!gr.name || !city.roadsBuilt[k]) return;
      const e = roads.get(gr.name);
      if (!e) roads.set(gr.name, { kind: 'road', name: gr.name, cls: gr.cls, icon: 'car' }); else e.cls = Math.max(e.cls, gr.cls);
    });
    roads.forEach(function (e) { e.sub = '道路 · ' + (CLS[e.cls] || '道路'); geo.push(e); });
    const seen = new Set();
    for (const p of D.places) if (!seen.has(p[0])) { seen.add(p[0]); geo.push({ kind: 'place', name: p[0], sub: '地名', x: p[1], y: p[2], icon: 'locate' }); }
    const entries = function () {
      const net = g.draft ? g.draft.net : g.net, out = [];
      for (const id in net.stations) {
        const s = net.stations[id], ls = M.stationLines(net, id).map(function (l) { return net.lines[l]; }).filter(Boolean);
        out.push({ kind: 'stations', id: id, name: s.name, sub: ls.length ? ls.map(function (l) { return l.name; }).join('、') + (ls.length > 1 ? ' · 换乘站' : '') : '未接入线路', color: ls[0] ? ls[0].color : null, x: s.x, y: s.y, st: true });
        if (favs.stations.indexOf(id) >= 0) favs.names[id] = s.name;
      }
      for (const id in net.lines) {
        const L = net.lines[id], tp = M.lineTopo(net, id);
        out.push({ kind: 'lines', id: id, name: L.name, sub: M.TOPO_NAME[tp.topo] + ' · ' + tp.stations.length + ' 站', color: L.color, line: true, stations: tp.stations.map(function (sid) { return net.stations[sid]; }).filter(Boolean) });
        if (favs.lines.indexOf(id) >= 0) favs.names[id] = L.name;
      }
      return out;
    };
    const open = function (it) {
      if (it.gone) return;
      self.closeSearch();
      if (it.st) { self.select({ kind: 'station', id: it.id }); self.flyTo(it.x, it.y, Math.max(self.R.cam.zoom, 24)); }
      else if (it.line) { self.openPage('line', it.id, { replaceTop: self.topIs(['station', 'line', 'road', 'zone', 'facility']) }); self.flyToStations(it.stations); }
      else if (it.kind === 'region') self.locateRegion(it.id);
      else if (it.kind === 'road') self.locateRoad(it.name);
      else if (it.kind === 'district') self.locatePoint(it.x, it.y, it.name, 4, 4);
      else self.locatePoint(it.x, it.y, it.name, it.kind === 'landmark' ? 0.8 : 1.2);
    };
    const canFav = function (it) { return it.kind === 'stations' || it.kind === 'lines'; };
    const row = function (it, k) {
      const star = canFav(it) ? h('button', { class: 'iconbtn fav' + (self.isFav(it.kind, it.id) ? ' on' : ''), 'data-tip': self.isFav(it.kind, it.id) ? '取消收藏' : '收藏', onclick: function (e) { e.stopPropagation(); self.toggleFav(it.kind, it.id); render(); input.focus(); } }, ic(self.isFav(it.kind, it.id) ? 'starOn' : 'star')) : null;
      const mark0 = it.line ? h('span', { class: 'swatch', style: { background: it.color } }) : it.st ? h('span', { class: 'st-dot', style: { borderColor: it.color || 'var(--muted)' } }) : h('span', { class: 'srch-ic' }, ic(it.icon));
      return h('div', { class: 'srch-item' + (k === cur ? ' on' : '') + (it.gone ? ' gone' : ''), role: 'option', onclick: function () { open(it); }, onmouseenter: function () { cur = k; mark(); } },
        mark0, h('div', { class: 'grow' }, h('div', { class: 'srch-name' }, it.name), h('div', { class: 'tiny muted' }, it.sub)), star);
    };
    const mark = function () { Array.prototype.forEach.call(list.querySelectorAll('.srch-item'), function (el, k) { el.classList.toggle('on', k === cur); }); };
    const render = function () {
      const q = input.value.trim().toLowerCase(), all = entries();
      list.innerHTML = ''; items = []; cur = 0;
      if (!q) {
        const fav = [];
        for (const kind of ['lines', 'stations']) for (const id of favs[kind]) {
          const e = all.find(function (x) { return x.kind === kind && x.id === id; });
          fav.push(e || { kind: kind, id: id, name: favs.names[id] || (kind === 'lines' ? '线路' : '车站'), sub: '已拆除，无法定位', gone: true });
        }
        if (fav.length) { list.appendChild(h('div', { class: 'srch-h' }, '收藏')); fav.forEach(function (it) { items.push(it); list.appendChild(row(it, items.length - 1)); }); }
        else list.appendChild(h('div', { class: 'note', style: { padding: '8px 10px' } }, '输入名称搜索车站、线路、道路、区域、地标或地名，选中后在地图上定位并高亮。在车站或线路详情中点击 ☆ 可收藏，收藏会显示在这里。'));
        const lines = all.filter(function (x) { return x.line && !self.isFav('lines', x.id); });
        if (lines.length) { list.appendChild(h('div', { class: 'srch-h' }, '全部线路')); lines.forEach(function (it) { items.push(it); list.appendChild(row(it, items.length - 1)); }); }
        return;
      }
      const hits = all.concat(geo).filter(function (x) { return x.name.toLowerCase().indexOf(q) >= 0; });
      const score = function (x) { const n = x.name.toLowerCase(); return (canFav(x) && self.isFav(x.kind, x.id) ? 0 : 1000) + (n === q ? 0 : n.indexOf(q) === 0 ? 100 : 200) + RANK[x.kind] * 10; };
      hits.sort(function (a, b) { return score(a) - score(b) || a.name.length - b.name.length; });
      if (!hits.length) { list.appendChild(h('div', { class: 'note', style: { padding: '8px 10px' } }, '没有名称包含「' + input.value.trim() + '」的车站、线路、道路、区域或地名。')); return; }
      hits.slice(0, 50).forEach(function (it) { items.push(it); list.appendChild(row(it, items.length - 1)); });
    };
    input.addEventListener('input', render);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (items.length) { cur = (cur + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; mark(); const el = list.querySelectorAll('.srch-item')[cur]; if (el) el.scrollIntoView({ block: 'nearest' }); } }
      else if (e.key === 'Enter') { e.preventDefault(); if (items[cur]) open(items[cur]); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); self.closeSearch(); }
    });
    document.body.appendChild(pop);
    this.searchEl = pop;
    render();
    setTimeout(function () { input.focus(); }, 0);
    this._searchClose = function (e) { if (self.searchEl && !self.searchEl.contains(e.target) && !self.hbtns.search.contains(e.target)) self.closeSearch(); };
    setTimeout(function () { window.addEventListener('pointerdown', self._searchClose, true); }, 0);
  };
  UI.prototype.closeSearch = function () {
    if (this.searchEl) { this.searchEl.remove(); this.searchEl = null; }
    if (this._searchClose) { window.removeEventListener('pointerdown', this._searchClose, true); this._searchClose = null; }
  };
  UI.prototype.openScreen = function (card, onEsc, cls) {
    if (this.tools) this.tools.cancelDrag();
    this.screen.innerHTML = '';
    this.screen.className = cls || '';
    this.screen.appendChild(card);
    this.screenEsc = onEsc || null;
  };
  UI.prototype.closeScreen = function () { this.screen.className = 'hidden'; this.screenEsc = null; this.screenRefresh = null; };
  UI.prototype.cardHead = function (icon, badge, title) { return h('div', { class: 'card-head' }, h('span', { class: 'badge ' + badge }, ic(icon)), h('h2', null, title)); };
  UI.prototype.confirm = function (title, text, okLabel, onOk, danger, icon) {
    const self = this;
    const prevCls = this.screen.className;
    const prev = prevCls.indexOf('hidden') >= 0 ? null : Array.from(this.screen.childNodes);
    const prevEsc = this.screenEsc;
    // 取消时原样放回上一个界面（不重播入场动画，避免闪动）
    const restore = function () { if (prev) { self.screen.innerHTML = ''; self.screen.className = prevCls + ' noanim'; prev.forEach(function (n) { self.screen.appendChild(n); }); self.screenEsc = prevEsc; } else self.closeScreen(); };
    const card = h('div', { class: 'card' }, this.cardHead(icon || (danger ? 'warn' : 'help'), danger ? 'b-red' : 'b-blue', title), h('div', { class: 'note', style: { fontSize: '13px' } }, text),
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: restore }, '取消'), h('button', { class: 'btn ' + (danger ? 'danger fill' : 'primary'), onclick: function () { restore(); onOk(); } }, okLabel)));
    this.openScreen(card, restore);
  };
  UI.prototype.showLoading = function (text) {
    this.openScreen(h('div', { class: 'card', style: { width: 'min(380px, calc(100vw - 32px))' } }, h('div', { class: 'loading' }, h('img', { class: 'logo-ink', src: 'img/logo-navy.png', alt: '' }), h('div', { class: 'muted' }, text))));
  };
  // 开始界面、选择地图、开局简报与更新公告见 screens.js
  // 退出：网页无法强制关闭自己打开的标签页时，给出提示
  UI.prototype.quitGame = function () {
    const self = this;
    this.confirm('退出游戏？', '进度已自动保存在本浏览器中，下次打开 index.html 可点击「继续游戏」。', '退出', function () {
      try { window.close(); } catch (e) { /* ignore */ }
      setTimeout(function () { if (!window.closed) self.openScreen(h('div', { class: 'card', style: { width: 'min(420px, calc(100vw - 32px))', textAlign: 'center' } }, h('img', { class: 'logo-ink', src: 'img/logo-navy.png', alt: '', style: { width: '72px', margin: '6px auto 12px', display: 'block' } }), h('h2', { style: { justifyContent: 'center' } }, '感谢游玩'), h('div', { class: 'note' }, '浏览器不允许网页自行关闭此标签页，请直接关闭它。'), h('div', { class: 'modal-actions', style: { justifyContent: 'center' } }, h('button', { class: 'btn primary', onclick: function () { self.showStart(); } }, '返回主菜单'))), function () { self.showStart(); }); }, 120);
    }, false, 'power');
  };
  // ======================== 设置 ========================
  // 设置：单页，只保留常用项；控件就地更新（不整页重绘），主题与界面大小平滑过渡
  UI.prototype.showSettings = function () {
    const self = this, S = CM.Settings;
    const inGame = !!this.g();
    const back = function () { if (inGame) self.closeScreen(); else self.showStart(); };
    const row = function (icon, title, ctl, desc) { return h('div', { class: 'set-row' }, h('span', { class: 'set-ico' }, ic(icon)), h('div', { class: 'grow' }, h('div', { class: 'set-t' }, title), desc ? h('div', { class: 'set-d' }, desc) : null), ctl); };
    const toggle = function (key, onChange) {
      const b = h('button', { class: 'switch' + (S.get(key) ? ' on' : ''), role: 'switch', 'aria-checked': S.get(key) ? 'true' : 'false', 'data-silent': '1', onclick: function () {
        S.set(key, !S.get(key)); b.classList.toggle('on', !!S.get(key)); b.setAttribute('aria-checked', S.get(key) ? 'true' : 'false'); snd('toggle'); if (onChange) onChange();
      } }, h('i'));
      return b;
    };
    const seg = function (key, opts, after) {
      const c = h('div', { class: 'seg-ctl' });
      const btns = opts.map(function (o) {
        return h('button', { class: S.get(key) === o[0] ? 'on' : '', 'data-silent': '1', onclick: function () {
          if (S.get(key) === o[0]) return;
          if (key === 'uiScale' && !S.reducedMotion()) document.getElementById('app').animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 380, easing: 'ease-out' });
          S.set(key, o[0]); snd('soft');
          btns.forEach(function (b, k) { b.classList.toggle('on', opts[k][0] === o[0]); });
          if (after) after();
        } }, o[2] ? ic(o[2]) : null, o[1]);
      });
      btns.forEach(function (b) { c.appendChild(b); });
      return c;
    };
    // 三路音量：总音量（含界面音效）、列车音效、城市环境音；关闭音效时一并变灰
    const volRows = [];
    const volRow = function (key, icon, title, desc) {
      const val = h('span', { class: 'set-val' }, Math.round(S.get(key) * 100) + '%');
      const input = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: S.get(key), 'aria-label': title, oninput: function (e) { S.set(key, +e.target.value); val.textContent = Math.round(e.target.value * 100) + '%'; }, onchange: function () { snd('good'); } });
      const r = row(icon, title, h('div', { class: 'set-slider' }, input, val), desc);
      r.classList.add('vol-row'); if (!S.get('sound')) r.classList.add('off');
      volRows.push(r);
      return r;
    };
    const body = h('div', { class: 'set-body single' },
      row('expand', '界面大小', seg('uiScale', [[0.9, '小'], [1, '标准'], [1.15, '大']])),
      row('label', '地图标注', seg('labels', [['all', '全部'], ['stations', '仅车站'], ['none', '关闭']])),
      row('car', '车辆与行人', toggle('agents'), '关闭后交通模拟照常进行，只是不显示运动的车辆和行人'),
      row('sound', '声音', toggle('sound', function () { volRows.forEach(function (r) { r.classList.toggle('off', !S.get('sound')); }); })),
      volRow('volume', 'sound', '总音量'),
      volRow('trainVol', 'train', '列车音效', '列车行驶、进出站与车门提示；跟随列车时更突出'),
      volRow('ambVol', 'building', '城市环境音', '车流、人声、水面与鸟鸣，随镜头位置、城区和时段变化'),
      row('save', '自动保存', toggle('autosave'), '暂停、每月结算与每次建设后自动保存'));
    const card = h('div', { class: 'card settings' },
      h('div', { class: 'card-head' }, h('span', { class: 'badge b-slate' }, ic('gear')), h('h2', null, '设置'), h('span', { class: 'grow' }), h('button', { class: 'iconbtn', 'data-tip': '关闭', 'data-key': 'Esc', onclick: back }, ic('close'))),
      body,
      h('div', { class: 'set-foot' },
        h('span', { class: 'muted tiny grow' }, '城市与地铁 v' + CFG.GAME_VERSION + ' · 地图 © OpenStreetMap 贡献者'),
        h('button', { class: 'btn sm ghost', onclick: function () { self.confirm('恢复默认设置？', '所有设置恢复为默认值，存档不受影响。', '恢复默认', function () { S.reset(); self.showSettings(); self.toast('已恢复默认设置', 'info'); }, true, 'gear'); } }, '恢复默认'),
        h('button', { class: 'btn primary sm', onclick: back }, '完成')));
    this.openScreen(card, back);
  };
  // 开始游戏 → 选择地图：每张地图可开始新游戏（选择模式）、继续该地图最近的进度，或读取该地图的存档
  UI.prototype.showNewGame = function () { this.showMapSelect(); };
  // mapId：只显示该地图的进度（从地图选择页进入时）
  UI.prototype.showSaveManager = function (inGame, mapId) {
    const self = this;
    const fileIn = h('input', { type: 'file', accept: '.json,.cmsave,application/json', style: { display: 'none' }, onchange: function (e) { const f = e.target.files[0]; if (f) self.importFile(f, true); e.target.value = ''; } });
    const list = h('div');
    const editing = new Set();
    const draw = function () {
      // 保存、导入等后台操作可能要求刷新列表；编辑结束前保留原输入框，避免丢字、焦点或打断中文输入。
      if (editing.size) return;
      list.innerHTML = '';
      const games = CM.Save.list(mapId);
      if (!games.length) list.appendChild(h('div', { class: 'note' }, mapId ? '该地图暂无存档。' : '暂无存档。'));
      for (const gm of games) {
        const grp = h('div', { class: 'game-group', 'data-game-id': gm.gameId });
        const title = h('span', { class: 'save-name-title' }, gm.name);
        const rename = h('button', { class: 'btn sm ghost save-name-rename', onclick: function () {
          if (editing.has(gm.gameId)) return;
          editing.add(gm.gameId); rename.disabled = true;
          const inputId = U.uid('save-name-');
          const input = h('input', { id: inputId, class: 'save-name-input', type: 'text', value: gm.name, autocomplete: 'off' });
          const status = h('div', { class: 'save-name-status tiny', role: 'status', 'aria-live': 'polite' });
          let busy = false;
          const finish = function () {
            editing.delete(gm.gameId); editor.remove(); rename.disabled = false;
            if (!editing.size) draw();
            const group = Array.from(list.children).find(function (el) { return el.dataset.gameId === gm.gameId; });
            const btn = group && group.querySelector('.save-name-rename'); if (btn) btn.focus();
          };
          const error = function (text) { status.textContent = text; status.classList.add('bad'); input.setAttribute('aria-invalid', 'true'); input.focus(); };
          const saveName = async function () {
            if (busy) return;
            const name = input.value.trim();
            if (!name) { error('名称不能为空，请输入进度名称。'); return; }
            busy = true; input.readOnly = true; save.disabled = cancel.disabled = true;
            status.textContent = '正在保存名称…'; status.classList.remove('bad'); input.removeAttribute('aria-invalid');
            try {
              // 已开始的自动或手动存档仍可能写入旧名称；等它们结束后再改索引。
              while (self.saving || self._manualSaves.size) {
                const pending = Array.from(self._manualSaves); if (self.saving) pending.push(self.saving);
                await Promise.all(pending);
              }
              const current = CM.Save.list().find(function (g) { return g.gameId === gm.gameId; });
              if (!current) throw new Error('该进度已不存在，请取消后刷新列表。');
              if (current.name !== name) CM.Save.rename(gm.gameId, name);
              const saved = CM.Save.list().find(function (g) { return g.gameId === gm.gameId; });
              if (!saved || saved.name !== name) throw new Error('未能写入名称，请重试。');
              const active = self.g();
              if (active && active.id === gm.gameId && active.name !== name) {
                active.name = name; active.touch(); self.markUnsaved(); self.scheduleAutosave();
              }
              gm.name = name; title.textContent = name;
              finish(); self.toast('进度名称已保存', 'good');
            } catch (e) {
              const reason = e && e.name === 'QuotaExceededError' ? '浏览器本地存储空间不足，请清理空间后重试。' : (e && e.message || '请稍后重试。');
              error('名称保存失败：' + reason);
            } finally { busy = false; input.readOnly = false; save.disabled = cancel.disabled = false; }
          };
          const save = h('button', { class: 'btn primary sm', onclick: saveName }, '保存');
          const cancel = h('button', { class: 'btn sm ghost', onclick: function () { if (!busy) finish(); } }, '取消');
          const editor = h('div', { class: 'save-name-editor' },
            h('label', { class: 'save-name-label', for: inputId }, '进度名称'),
            h('div', { class: 'save-name-controls' }, input, h('div', { class: 'save-name-actions' }, save, cancel)), status);
          editor.addEventListener('keydown', function (e) {
            if (e.isComposing || e.keyCode === 229) return;
            if (e.key === 'Enter' && e.target === input) { e.preventDefault(); e.stopPropagation(); saveName(); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!busy) finish(); }
          });
          input.addEventListener('input', function () { status.textContent = ''; status.classList.remove('bad'); input.removeAttribute('aria-invalid'); });
          grp.insertBefore(editor, grp.children[1] || null); input.focus(); input.select();
        } }, ic('pencil'), '重命名');
        grp.appendChild(h('div', { class: 'h save-name-heading' }, ic(CM.modeCaps(gm.mode).budget ? 'trophy' : 'sparkle'), title, h('span', { class: 'tag' }, CM.modeName(gm.mode)), mapId ? null : h('span', { class: 'tag info' }, (CM.MAPS[gm.map || 'gz'] || { name: gm.map }).name),
          h('div', { class: 'save-name-actions' }, rename,
            h('button', { class: 'btn sm ghost danger', onclick: function () { self.confirm('删除整个进度？', '「' + gm.name + '」的全部 ' + gm.slots.length + ' 个存档将被永久删除。', '删除', function () { CM.Save.removeGame(gm.gameId); self.showSaveManager(inGame, mapId); }, true, 'trash'); } }, ic('trash'), '删除进度'))));
        for (const sl of gm.slots) grp.appendChild(self.slotRow(sl, inGame));
        list.appendChild(grp);
      }
    };
    draw();
    this.screenRefresh = draw;
    const back = function () { if (inGame) self.closeScreen(); else if (mapId) self.showMapSelect(mapId); else self.showStart(); };
    const card = h('div', { class: 'card wide' }, this.cardHead('folder', 'b-blue', '读取存档' + (mapId && CM.MAPS[mapId] ? ' · ' + CM.MAPS[mapId].name : '')),
      h('div', { class: 'note' }, '每个进度相互独立；自动存档在两个位置轮换写入，手动存档最多 ' + CFG.saves.maxManual + ' 个。导入的存档会作为新的存档加入，不会覆盖已有进度。'),
      list, fileIn,
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: function () { fileIn.click(); } }, ic('import'), '导入存档文件'), h('button', { class: 'btn primary', onclick: back }, inGame ? '关闭' : '返回')));
    this.openScreen(card, back);
  };
  UI.prototype.importFile = function (file, keepScreen) {
    const self = this;
    if (file.size > 30 * 1024 * 1024) { this.toast('文件过大，不是有效的存档', 'bad'); return; }
    const rd = new FileReader();
    rd.onload = function () {
      CM.Save.importText(String(rd.result)).then(function (r) {
        self.toast('已导入存档「' + r.name + '」（地图：' + ((CM.MAPS[r.map] || {}).name || r.map) + '）', 'good');
        if (keepScreen && self.screenRefresh) self.screenRefresh();
        else self.confirm('导入成功', '存档「' + r.name + '」已加入存档列表。是否立即载入？', '载入', function () { self.loadSlot(r.slotId); }, false, 'import');
      }).catch(function (e) {
        snd('error');
        self.openScreen(h('div', { class: 'card' }, self.cardHead('error', 'b-red', '导入失败'), self.callout('bad', 'error', e.message), h('div', { class: 'note' }, '原有存档未受影响。'), h('div', { class: 'modal-actions' }, h('button', { class: 'btn primary', onclick: function () { if (self.g()) self.closeScreen(); else self.showStart(); } }, '确定'))));
      });
    };
    rd.onerror = function () { self.toast('读取文件失败', 'bad'); };
    rd.readAsText(file);
  };
  UI.prototype.loadSlot = function (slotId) {
    const self = this;
    this.showLoading('正在读取存档…');
    CM.Save.load(slotId).then(function (data) { CM.loadGame(data); }, function (e) {
      snd('error');
      self.openScreen(h('div', { class: 'card' }, self.cardHead('error', 'b-red', '无法载入'), self.callout('bad', 'error', e.message), h('div', { class: 'note' }, '原有存档与当前进度未受影响。'), h('div', { class: 'modal-actions' }, h('button', { class: 'btn primary', onclick: function () { if (self.g()) self.closeScreen(); else self.showStart(); } }, '确定'))));
    });
  };
  // 返回主菜单：先确认最新状态已成功保存；保存失败时保留当前游戏
  // after：返回后要打开的界面（默认主菜单）
  UI.prototype.backToMenu = function (after) {
    const self = this;
    const g = this.g();
    const go = function () { CM.endGame(); if (typeof after === 'function') after(); else self.showStart(); };
    if (!g) { go(); return; }
    const leave = function () {
      if (g.speed > 0) self.setSpeed(0);   // 先暂停，保证保存的就是离开时的状态
      if (self.isSaved()) { go(); return; }
      self.showLoading('正在保存当前进度…');
      self.doAutosave(true).then(function (r) {
        if (self.g() !== g) return;
        if (r && r.ok && self.isSaved()) { go(); return; }
        snd('error');
        self.openScreen(h('div', { class: 'card' }, self.cardHead('error', 'b-red', '保存失败，未返回主菜单'),
          self.callout('bad', 'error', (r && r.error) || '当前进度未能保存。'),
          h('div', { class: 'note' }, '当前游戏仍保留在内存中。可以重试，或先「导出当前进度」作为备份。'),
          h('div', { class: 'modal-actions' },
            h('button', { class: 'btn danger', onclick: function () { go(); } }, '不保存，直接返回'),
            h('button', { class: 'btn', onclick: function () { self.closeScreen(); } }, '留在游戏'),
            h('button', { class: 'btn primary', onclick: function () { self.closeScreen(); leave(); } }, '重试保存'))));
      });
    };
    const ev = g.draft ? g.draftEval() : null;
    if (ev && ev.changed) this.confirm('返回主菜单？', '未确认的建设草案不会保存（' + (ev.changes.add.length + ev.changes.mod.length + ev.changes.del.length) + ' 项修改）。当前进度会先保存，再返回主菜单。', '放弃草案并返回', leave, true, 'home');
    else leave();
  };

  // ======================== 保存 ========================
  UI.prototype.markUnsaved = function () { if (this.save.state !== 'saving') this.save.state = this.save.state === 'error' ? 'error' : 'unsaved'; };
  // 已保存 = 最近一次成功保存的就是当前状态（游戏版本与游戏时钟都一致）
  UI.prototype.isSaved = function () {
    const g = this.g(), s = this.save;
    if (!g || s.state !== 'saved' || !s.clock) return false;
    const c = g.clock;
    return s.rev === g.rev && s.clock.y === c.y && s.clock.m === c.m && s.clock.d === c.d && Math.abs(s.clock.minute - c.minute) < 1;
  };
  UI.prototype.saveSnap = function (g) { return { rev: g.rev, clock: Object.assign({}, g.clock) }; };
  UI.prototype.markSaved = function (g, at, snap) { this.save = Object.assign({ state: 'saved', at: at, msg: '' }, snap || this.saveSnap(g)); };
  UI.prototype.scheduleAutosave = function () {
    const self = this;
    if (!CM.Settings.get('autosave')) return;
    clearTimeout(this._autoT);
    this._autoT = setTimeout(function () { const g = self.g(); if (g && !g.jumping && !g.pending) self.doAutosave(); else if (g) self.scheduleAutosave(); }, 700);
  };
  // 自动保存；返回 Promise<{ok, error}>。force：返回菜单等场合，等待进行中的保存结束后再保存最新状态
  UI.prototype.doAutosave = function (force) {
    const g = this.g(); if (!g) return Promise.resolve({ ok: true });
    this.lastAuto = performance.now();
    const self = this;
    // 旧存档升级但升级前备份未能建立：暂停自动保存，避免自动存档轮换覆盖原存档（手动保存为新存档不受影响）
    if (g.backupFailed) return Promise.resolve({ ok: false, error: '升级前备份未建立，已暂停自动保存（可手动保存为新存档）' });
    // 拖动编辑或月度结算进行中：不保存中间状态（force 时稍后重试）
    if ((g.draft && g.draft.liveSnap) || g.pending || g.jumping) return force ? new Promise(function (res) { setTimeout(function () { res(self.doAutosave(true)); }, 200); }) : Promise.resolve({ ok: false, error: '正在结算' });
    if (this.saving) return force ? this.saving.then(function () { return self.isSaved() ? { ok: true } : self.doAutosave(true); }) : this.saving;
    this.save.state = 'saving';
    const ver = this.saveSeq = (this.saveSeq || 0) + 1;
    const snap = this.saveSnap(g);
    this.saving = CM.Save.save(g, 'auto').then(function (r) {
      self.saving = null;
      if (self.g() !== g) return r;
      if (r.ok) { if (self.saveSeq === ver) self.markSaved(g, r.savedAt, snap); }
      else { self.save = Object.assign({}, self.save, { state: 'error', at: Date.now(), msg: r.error }); self.toast('自动保存失败：' + r.error, 'bad'); }
      return r;
    });
    return this.saving;
  };
  UI.prototype.manualSave = function (slotId, label) {
    const g = this.g(); if (!g) return Promise.resolve();
    if (g.pending || g.jumping) { this.toast('正在进行月度结算，请稍候再保存', 'info'); return Promise.resolve({ ok: false, error: '正在结算' }); }
    const self = this, snap = this.saveSnap(g);
    const pending = CM.Save.save(g, 'manual', { slotId: slotId, label: label || ('手动存档 ' + g.clock.y + '年' + g.clock.m + '月') }).then(function (r) {
      if (self.g() !== g) return r;
      if (r.ok) { self.markSaved(g, r.savedAt, snap); self.toast('已保存到本地（' + (r.size / 1024).toFixed(0) + ' KB）', 'good'); }
      else { self.save = Object.assign({}, self.save, { state: 'error', at: Date.now(), msg: r.error }); self.toast('保存失败：' + r.error, 'bad'); }
      self.rerenderPage();
      if (self.screenRefresh) self.screenRefresh();
      return r;
    });
    this._manualSaves.add(pending);
    return pending.finally(function () { self._manualSaves.delete(pending); });
  };

  // ======================== 跳月/跳年 与 失败 ========================
  UI.prototype.showJump = function () {
    const g = this.g(), j = g.jumping;
    this.jumpBar = h('i', { style: { width: '2%' } });
    const t = j.target;
    this.openScreen(h('div', { class: 'card' }, this.cardHead('calYear', 'b-teal', '时间推进中'), h('div', { class: 'note' }, g.clock.y + '年' + g.clock.m + '月 → ' + t[0] + '年' + t[1] + '月：逐日结算票款与运营费用，按月处理拨款、城市发展、区域开放与任务。'), h('div', { class: 'progress', style: { marginTop: '14px', height: '9px' } }, this.jumpBar)), null);
  };
  UI.prototype.updateJump = function (p) { if (this.jumpBar) this.jumpBar.style.width = Math.round(p * 100) + '%'; };
  // 推进完成报告：推进一个月给出简短消息（可展开完整报告）；推进一年直接显示报告。
  // 报告：期间时间轴（大事标记）· 城市与交通指标卡（前 → 后与变化）· 城市经济 · 财政收支（经营挑战）· 任务 · 期间大事
  UI.prototype.showJumpResult = function (r) {
    const g = this.g(), self = this, a = r.after;
    const months = (r.to[0] - r.from[0]) * 12 + (r.to[1] - r.from[1]);
    this.lastReport = r;
    if (months <= 1 && !r.failed) {
      this.closeScreen();
      const d = a.pop - r.before.pop;
      this.toast('已推进到 ' + r.to[0] + '年' + r.to[1] + '月：人口 ' + U.fmtPeople(a.pop) + '（' + (d >= 0 ? '+' : '−') + U.fmtPeople(Math.abs(d)) + '），地铁分担率 ' + U.fmtPct(a.share) + (g.econ.isFree() ? '' : '，资金 ' + U.fmtMoney(a.funds)), 'good', { label: '查看报告', fn: function () { self.showReport(r); } });
      this.rerenderPage();
      return;
    }
    this.showReport(r);
    this.rerenderPage();
  };
  UI.prototype.showReport = function (r) {
    const g = this.g(), self = this, b = r.before, a = r.after, free = g.econ.isFree();
    const fromYm = U.ymIndex(r.from[0], r.from[1]), toYm = U.ymIndex(r.to[0], r.to[1]), months = Math.max(1, toYm - fromYm);
    const evs = g.events.filter(function (e, i) { const ym = U.ymIndex(e.y, e.m); return (ym > fromYm && ym <= toYm) || (ym === fromYm && i >= b.events); });
    const cat = function (e) {
      if (e.kind === 'econ') return ['econ', '经济', '#7c5cd6'];
      if (e.tag === '任务') return ['task', '任务', '#c27c0e'];
      if (/^新区域开放|^填海成陆/.test(e.title)) return ['city', '城市', '#1f9254'];
      if (e.tag === '建设' || e.tag === '经营') return ['build', e.tag, '#2f6fa8'];
      if (e.tag === '模拟') return ['sim', '模拟', '#8a7ad6'];
      return ['hist', '史实', '#c46a2a'];
    };
    // ---- 期间时间轴 ----
    const tl = h('div', { class: 'jr-tl' });
    for (let k = 0; k <= months; k++) {
      const ym = fromYm + k, y = Math.floor(ym / 12), m = ym % 12 + 1;
      const here = evs.filter(function (e) { return U.ymIndex(e.y, e.m) === ym; });
      const cats = Array.from(new Set(here.map(function (e) { return cat(e)[0]; })));
      tl.appendChild(h('div', { class: 'jr-m' + (k === 0 ? ' first' : '') + (k === months ? ' last' : ''), 'data-tip': here.length ? y + '年' + m + '月：' + here.map(function (e) { return e.title; }).slice(0, 4).join('；') : null },
        h('i', { class: 'jr-dot' + (here.length ? ' on' : '') }, cats.slice(0, 3).map(function (c) { const e = here.find(function (x) { return cat(x)[0] === c; }); return h('b', { style: { background: cat(e)[2] } }); })),
        // 标签：起点、终点，以及与两端相距 3 个月以上的每年 1 月（避免相互重叠）
        (k === 0 || k === months || (m === 1 && k >= 3 && months - k >= 3)) ? h('span', null, y + '.' + m) : null));
    }
    // ---- 指标卡 ----
    const tile = function (icon, label, x0, x1, fmt, betterUp, dfmt) {
      const d = x1 - x0, eps = Math.abs(x0) * 1e-6 + 1e-9, flat = Math.abs(d) < eps;
      const cls = flat ? 'muted' : ((d > 0) === betterUp ? 'good' : 'bad');
      return h('div', { class: 'jr-tile' }, h('div', { class: 'jt-k' }, ic(icon, 15), label), h('div', { class: 'jt-v num' }, fmt(x1)),
        h('div', { class: 'jt-d ' + cls }, flat ? '持平' : (d > 0 ? '▲ ' : '▼ ') + (dfmt || fmt)(Math.abs(d))), h('div', { class: 'jt-b' }, '原 ' + fmt(x0)));
    };
    const pp = function (x) { return (x * 100).toFixed(1) + ' 个百分点'; };
    const grid = h('div', { class: 'jr-grid' },
      tile('people', '人口', b.pop, a.pop, U.fmtPeople, true),
      tile('briefcase', '就业岗位', b.jobs, a.jobs, U.fmtPeople, true),
      tile('metro', '日均地铁客运', b.riders, a.riders, U.fmtPeople, true),
      tile('train', '地铁分担率', b.share, a.share, function (x) { return U.fmtPct(x); }, true, pp),
      tile('car', '拥堵指数', b.cong, a.cong, function (x) { return x.toFixed(2); }, false),
      tile('timer', '平均通勤', b.commute, a.commute, function (x) { return U.fmtNum(x, 1) + ' 分'; }, false),
      tile('smile', '满意度', b.sat, a.sat, function (x) { return String(Math.round(x)); }, true, function (x) { return x.toFixed(1); }),
      tile('map', '已开放区域', b.regions, a.regions, function (x) { return x + ' 个'; }, true, function (x) { return x + ' 个'; }));
    const parts = [h('div', { class: 'jr-sec' }, ic('building', 15), '城市与交通'), grid];
    // ---- 城市经济 ----
    if (g.macro && CM.Macro) {
      const mv = CM.Macro.view(g), recs = g.macro.rec.slice(b.macroRecs || 0);
      const box = h('div', { class: 'jr-econ' });
      if (recs.length) for (const rc of recs) box.appendChild(h('div', { class: 'je-row' }, h('b', null, rc.y + ' 年'), h('span', null, 'GDP ' + UI.fmtBig(rc.nom)), h('span', { class: rc.growth == null ? 'muted' : (rc.growth >= 0 ? 'good' : 'bad') }, '实际增长 ' + UI.pctS(rc.growth)), h('span', { class: 'muted' }, '价格 ' + UI.pctS(rc.infl))));
      else box.appendChild(h('div', { class: 'small muted' }, '期间没有年度结算（每年 1 月结算上一年）。本年预测：GDP 约 ' + UI.fmtBig(mv.fc.nom) + (mv.fc.growth != null ? '，实际增长约 ' + UI.pctS(mv.fc.growth) : '') + '。'));
      box.appendChild(h('div', { class: 'je-env' }, h('span', { class: 'env-chip ' + mv.env.cls }, ic('pulse', 13), '经济环境：' + mv.env.label), h('span', { class: 'env-chip ' + (mv.te.eff >= 1 ? 'good' : 'warn') }, ic('metro', 13), '交通对经济 ' + UI.pctS(mv.te.eff - 1)),
        !free && Math.abs(a.fiscF - b.fiscF) > 1e-6 ? h('span', { class: 'env-chip ' + (a.fiscF >= b.fiscF ? 'good' : 'warn') }, ic('bank', 13), '财力系数 ×' + b.fiscF.toFixed(2) + ' → ×' + a.fiscF.toFixed(2)) : null));
      parts.push(h('div', { class: 'jr-sec' }, ic('trend', 15), '城市经济', h('button', { class: 'linkbtn', onclick: function () { self.closeScreen(); self.openTop('econ'); } }, '查看', ic('chev', 13))), box);
    }
    // ---- 财政（经营挑战）：期间已封账月份的收支 ----
    if (!free) {
      const rows = g.econ.ledger.filter(function (x) { const ym = U.ymIndex(x.y, x.m); return ym >= fromYm && ym < toYm; });
      let inc = 0, ops = 0, bld = 0, svc = 0, bond = 0;
      for (const x of rows) { inc += (x.grant || 0) + (x.fare || 0) + (x.reward || 0); ops += x.ops || 0; for (const k of CM.Economy.BUILD_KINDS) bld += x[k] || 0; svc += (x.interest || 0) + (x.principal || 0) + (x.penalty || 0); bond += x.bond || 0; }
      const fb = h('div', { class: 'jr-fin' },
        h('div', null, h('small', null, '财政收入'), h('b', { class: 'good' }, '+' + U.fmtMoney(inc))),
        h('div', null, h('small', null, '运营成本'), h('b', { class: 'warn' }, '−' + U.fmtMoney(ops))),
        bld > 0.5 ? h('div', null, h('small', null, '建设支出'), h('b', { class: 'warn' }, '−' + U.fmtMoney(bld))) : null,
        svc > 0.5 ? h('div', null, h('small', null, '偿债'), h('b', { class: 'bad' }, '−' + U.fmtMoney(svc))) : null,
        bond > 0.5 ? h('div', null, h('small', null, '债券募集'), h('b', null, '+' + U.fmtMoney(bond))) : null,
        h('div', { class: 'jf-net' }, h('small', null, '一般资金'), h('b', { class: a.funds >= b.funds ? 'good' : 'bad' }, U.fmtMoney(b.funds) + ' → ' + U.fmtMoney(a.funds))));
      parts.push(h('div', { class: 'jr-sec' }, ic('coin', 15), '财政收支（' + rows.length + ' 个已结算月份）', h('button', { class: 'linkbtn', onclick: function () { self.closeScreen(); self.openTop('money'); } }, '查看', ic('chev', 13))), fb);
    }
    // ---- 任务 ----
    const tEv = evs.filter(function (e) { return e.tag === '任务'; });
    if (tEv.length) {
      const chip = function (e) { const ok = e.title.indexOf('任务完成') === 0, bad = e.title.indexOf('任务未完成') === 0; return h('div', { class: 'jr-task ' + (ok ? 'ok' : (bad ? 'bad' : 'new')) }, ic(ok ? 'check' : (bad ? 'close' : 'flag'), 14), h('span', null, e.title.replace(/^(新任务|任务完成|任务未完成)[:：]\s*/, '')), h('em', null, ok ? '完成' : (bad ? '未完成' : '新任务'))); };
      parts.push(h('div', { class: 'jr-sec' }, ic('flag', 15), '任务', h('button', { class: 'linkbtn', onclick: function () { self.closeScreen(); self.openTop('tasks'); } }, '查看', ic('chev', 13))), h('div', { class: 'jr-tasks' }, tEv.slice(-8).map(chip)));
    }
    // ---- 期间大事（不含任务） ----
    const other = evs.filter(function (e) { return e.tag !== '任务'; });
    if (other.length) {
      parts.push(this.sec('jr-ev', '期间大事', other.length + ' 条', function () {
        const x = h('div', { class: 'jr-evs' });
        for (const e of other.slice(-40).reverse()) { const c = cat(e); x.appendChild(h('div', { class: 'jr-ev' }, h('span', { class: 'jr-ed' }, e.y + '.' + e.m), h('span', { class: 'jr-ec', style: { color: c[2], borderColor: c[2] } }, c[1]), h('span', { class: 'grow' }, e.title))); }
        return x;
      }, other.length <= 8, 'tasks'));
    }
    const card = h('div', { class: 'card jr' },
      h('div', { class: 'card-head' }, h('span', { class: 'badge ' + (r.failed ? 'b-red' : 'b-green') }, ic(r.failed ? 'error' : 'report')), h('div', { class: 'grow' }, h('h2', null, r.failed ? '推进中止：经营挑战失败' : '推进完成'), h('div', { class: 'tiny muted' }, r.from[0] + '年' + r.from[1] + '月 → ' + r.to[0] + '年' + r.to[1] + '月 · ' + months + ' 个月' + (evs.length ? ' · ' + evs.length + ' 件大事' : ''))),
        h('button', { class: 'iconbtn', 'data-tip': '关闭', 'data-key': 'Esc', onclick: function () { self.closeScreen(); } }, ic('close'))),
      h('div', { class: 'jr-scroll' }, tl, parts),
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn', onclick: function () { self.closeScreen(); self.openStats(); } }, ic('chart'), '查看统计'), h('button', { class: 'btn primary', onclick: function () { self.closeScreen(); } }, '继续')));
    this.openScreen(card, function () { self.closeScreen(); });
  };
  UI.prototype.showFailure = function (f) {
    const g = this.g(), self = this;
    const card = h('div', { class: 'card' }, this.cardHead('error', 'b-red', '经营挑战失败'),
      this.callout('bad', 'error', h('div', null, f.reasons.map(function (r) { return h('div', null, '· ' + r); }))),
      this.kv([['资金', U.fmtMoney(g.econ.funds)], ['满意度', Math.round(g.econ.sat) + ''], ['连续负余额', g.econ.negMonths + ' 个月'], ['满意度过低', g.econ.lowSatMonths + ' 个月']]),
      h('div', { class: 'note', style: { marginTop: '8px' } }, '可以查看财政与指标详情了解恶化原因；读取之前的存档重新经营，或转为自由建造继续发展这座城市（城市经济照常模拟）。'),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', onclick: function () { self.closeScreen(); self.openPage('finance', null, { root: true }); } }, ic('coin'), '财政详情'),
        h('button', { class: 'btn', onclick: function () { self.showSaveManager(true); } }, ic('folder'), '读取存档'),
        h('button', { class: 'btn', onclick: function () { self.backToMenu(); } }, ic('home'), '主菜单'),
        h('button', { class: 'btn primary', onclick: function () { g.econ.mode = 'free'; g.mode = 'free'; g.econ.failed = null; g.logEvent({ tag: '经营', title: '转为自由建造模式继续', desc: '' }); self.closeScreen(); self.toast('已转为自由建造模式', 'info'); self.markUnsaved(); } }, ic('sparkle'), '转为自由建造继续')));
    this.openScreen(card, function () { self.closeScreen(); });
  };
})(window.CM);
