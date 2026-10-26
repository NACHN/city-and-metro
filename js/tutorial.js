'use strict';
// 新手教程（青湾地图）：左上角的引导卡片按步骤给出目标与操作说明，自动检测完成情况；
// 相关按钮闪烁提示，地图上高亮目标位置。进度随存档保存，可跳过任意一步。
(function (CM) {
  const U = CM.U, h = U.h, M = CM.Metro;
  const ic = function (n, s) { return CM.icon(n, s); };
  const snd = function (n) { if (CM.Sound) CM.Sound.play(n); };
  let ui = null, g = null, el = null, idx = -1, ctx = {}, doneAt = 0, target = null, mini = false, lastCheck = 0;

  const place = function (name) { const p = CM.DATA.places.find(function (q) { return q[0] === name; }); return p ? { x: p[1], y: p[2] } : { x: 0, y: 0 }; };
  const absMin = function (c) { return (U.ymIndex(c.y, c.m) * 31 + c.d) * 1440 + c.minute; };
  const nets = function () { return g.draft ? [g.draft.net, g.net] : [g.net]; };
  const near = function (net, p, r) { for (const id in net.stations) { const s = net.stations[id]; if (U.dist(s.x, s.y, p.x, p.y) <= r) return id; } return null; };
  const lineStations = function (net, lid) { const tp = M.lineTopo(net, lid); return (tp.stations || []).map(function (sid) { return net.stations[sid]; }).filter(Boolean); };
  const NORTH = ['oldtown', 'xiguan', 'dongguan', 'beizhan', 'eastind'], SOUTH = ['nanan', 'tech'];
  const regionId = function (s) { const rg = g.city.regionAt(s.x, s.y); return rg ? rg.id : ''; };

  // 步骤：title 目标、body 说明、hint 小提示、target 闪烁的按钮、hl 地图高亮、check 完成条件、manual 需点击按钮继续
  const STEPS = [
    { id: 'intro', title: '欢迎来到青湾', manual: '开始教程',
      body: '青湾是一座约 42 万人的小城，青江从城中穿过，城市还没有地铁。接下来用 12 个小任务带你学会规划地铁：每完成一步会自动进入下一步，也可以随时跳过。' },
    { id: 'move', title: '移动地图',
      body: '按住左键拖动地图平移，滚动滚轮缩放（也可以用 + − 键）。按 T 在 2D 平面与 2.5D 立体之间切换。',
      hint: '试着拖动地图，再缩放一下。',
      enter: function () { const c = ui.R.cam; ctx.cam0 = { x: c.cx, y: c.cy, z: c.zoom }; },
      check: function () { const c = ui.R.cam, c0 = ctx.cam0; return U.dist(c.cx, c.cy, c0.x, c0.y) > 3 || Math.abs(Math.log(c.zoom / c0.z)) > 0.25; } },
    { id: 'pop', title: '看懂城市：人口密度',
      body: '左侧是分析图层。点击「人口密度」图层：颜色越深人口越多。钟楼一带的老城最密集，这里最需要地铁。',
      target: function () { return ui.dockBtns.pop; },
      check: function () { return ui.layer === 'pop'; } },
    { id: 'station', title: '建第一座车站',
      body: '点击底部的「建站」工具（或按 B），在地图上高亮的钟楼一带点击，放置第一座车站。新车站会自动采用附近的地名。',
      hint: '再次点击图层按钮可以关闭图层。',
      target: function () { return ui.tools.tool === 'station' ? null : ui.tbtns.station; },
      hl: function () { const p = place('钟楼'); return { kind: 'circle', x: p.x, y: p.y, r: 2.2, lx: p.x, ly: p.y - 2.2, label: '在这里建站' }; },
      enter: function () { const p = place('钟楼'); ui.R.flyTo(p.x, p.y + 1, Math.max(ui.R.cam.zoom, 22)); },
      check: function () { const p = place('钟楼'); return nets().some(function (n) { return !!near(n, p, 2.4); }); } },
    { id: 'line', title: '画第一条线路',
      body: '选择「绘线」工具（或按 L），从钟楼站出发，依次点击空地放置车站，一直连到北面的青湾火车站。右键或按 Enter 结束绘制。',
      hint: '至少 4 座车站；站距 500–1000 m（2–4 格）比较合适。',
      target: function () { return ui.tools.tool === 'line' ? null : ui.tbtns.line; },
      hl: function () { const a = place('钟楼'), b = place('青湾站'); return { kind: 'multi', items: [{ kind: 'circle', x: a.x, y: a.y, r: 2.2, lx: a.x, ly: a.y - 2.2, label: '起点：钟楼' }, { kind: 'circle', x: b.x, y: b.y, r: 2.2, lx: b.x, ly: b.y - 2.2, label: '终点：青湾站' }] }; },
      enter: function () { const a = place('钟楼'), b = place('青湾站'); ui.fitBox(Math.min(a.x, b.x) - 3, Math.min(a.y, b.y) - 3, Math.max(a.x, b.x) + 3, Math.max(a.y, b.y) + 3, 24); },
      check: function () {
        const a = place('钟楼'), b = place('青湾站');
        return nets().some(function (n) {
          for (const lid in n.lines) { const ss = lineStations(n, lid); if (ss.length >= 4 && ss.some(function (s) { return U.dist(s.x, s.y, a.x, a.y) <= 2.4; }) && ss.some(function (s) { return U.dist(s.x, s.y, b.x, b.y) <= 2.4; })) return true; }
          return false;
        });
      } },
    { id: 'confirm', title: '确认建设',
      body: '底部的草案栏显示了本次修改的费用与冲突，点「草案」可以查看预测客流。确认无误后点击「确认建设」（或 Ctrl+Enter），线路立即开通。',
      hint: '草案可以随时撤销（Ctrl+Z）或放弃，确认前不会产生费用。',
      target: function () { return ui.draftbar.querySelector('.btn.primary'); },
      check: function () { for (const lid in g.net.lines) if (lineStations(g.net, lid).length >= 4) return g.compiled.routes.length > 0; return false; } },
    { id: 'run', title: '让时间走起来',
      body: '按空格或点击 ▶ 开始，再试试 3× 速度。列车数由系统按站数、站距与客流自动配置；早高峰（7–9 点）乘客最多。',
      hint: '让游戏时间走过 3 小时。',
      target: function () {
        if (g.speed > 1) return null;
        // 宽屏用按钮组，窄屏只有一个循环按钮——引导要指向当前可见的那个
        const wide = window.innerWidth > 760;
        if (!wide) return ui.tbtns.speed;
        return g.speed === 0 ? ui.tbtns.pause : ui.tbtns.s2;
      },
      enter: function () { if (g.tutorial.runT0 == null) g.tutorial.runT0 = absMin(g.clock); ctx.t0 = g.tutorial.runT0; },   // 计时起点随进度保存，读档后不重新计时
      check: function () { return absMin(g.clock) - ctx.t0 >= 180; } },
    { id: 'inspect', title: '查看车站与线路',
      body: '点击一座车站，右侧会显示它的进出站客流、高峰负荷与换乘情况；点击线路则可以看到发车间隔、运行列车数与断面客流。',
      check: function () { return ui.topIs(['station', 'line']); } },
    { id: 'river', title: '跨过青江',
      body: '青江南岸的「南岸新区」正在发展。延长 1 号线（选中线路后拖动端点的「+」）或新建一条线路，跨过青江在南岸设站，再确认建设。',
      hint: '跨江段建成高架就是桥梁，建成地下就是隧道，可在选项条中选择。',
      hl: function () { const k = g.city.regions.findIndex(function (r) { return r.id === 'nanan'; }); const rg = g.city.regions[k]; return k >= 0 ? { kind: 'region', region: k, lx: rg.cx, ly: rg.cy, label: '南岸新区' } : null; },
      enter: function () { ui.fitBox(10, 12, 30, 30, 18); },
      check: function () {
        for (const lid in g.net.lines) {
          const ss = lineStations(g.net, lid), ids = ss.map(regionId);
          if (ids.some(function (r) { return NORTH.indexOf(r) >= 0; }) && ids.some(function (r) { return SOUTH.indexOf(r) >= 0; })) return true;
        }
        return false;
      } },
    { id: 'xfer', title: '建一座换乘站',
      body: '再画一条新线路，让它经过已有线路的某座车站（绘线时点击那座车站即可接入），形成换乘站。换乘站会显示 ⇄ 换乘标志。',
      hint: '从空地开始绘制新线路，中途点击已有车站；完成后确认建设。',
      check: function () { for (const id in g.net.stations) if (M.stationLines(g.net, id).length >= 2) return true; return false; } },
    { id: 'layers', title: '看看地铁的影响',
      body: '打开「道路拥堵」或「出行方向」图层：地铁开通后，沿线道路会更畅通；出行方向箭头中间的蓝色部分是乘地铁的比例。',
      target: function () { return ui.layer === 'cong' || ui.layer === 'flow' ? null : ui.dockBtns.cong; },
      check: function () { return ui.layer === 'cong' || ui.layer === 'flow'; } },
    { id: 'follow', title: '跟随一列列车',
      body: '点击地图上正在行驶的列车，镜头会自动跟随它驶过城区、青江与高架桥。按 H 隐藏界面欣赏画面，按 Esc 退出跟随。',
      hint: '列车只在运营时间（06:00–24:00）行驶；游戏暂停时列车停在原地。',
      enter: function () { if (ui.layer !== 'none') ui.setLayer('none'); },
      check: function () { return !!g.tutorial.followed; } },   // 按本进度判定，不受其他进度的跟随影响
    { id: 'netmap', title: '线路示意图',
      body: '按 K 或点击左侧的「线路示意图」：换乘站标志与地图一致，可以平滑缩放，也可以导出 PNG 图片。',
      target: function () { return CM.Follow && CM.Follow.active() ? null : ui.tbtns.netmap; },
      check: function () { return !!(CM.NetMap && CM.NetMap.isOpen()); } },
    // 经济小知识（可跳过、可回看，不计入 12 个任务；青湾为自由建造，不实际发行债券）
    { id: 'money', title: '小知识：经营挑战的财政', info: true,
      body: '正式城市的「经营挑战」要自己管钱：每月有政府拨款与票款，建设和运营都要花钱；资金紧张时可以发行地方债或城投债，借来的钱只能用于地铁建设，每年付息、到期还本。',
      hint: '点「图文说明」查看详细介绍与操作方法；之后也可以在「菜单 → 操作说明」中回看。' },
    { id: 'done', title: '教程完成！', final: true,
      body: '你已经学会了移动地图、读图层、建站绘线、确认建设、跨江与换乘、查看客流、跟随列车和线路示意图。可以继续在青湾自由建设，也可以去广州开始正式游戏：广州有经营挑战、历史任务和逐年开放的新区。' },
  ];
  const TASKS = STEPS.filter(function (s) { return !s.manual && !s.final && !s.info; }).length;   // 不含欢迎、小知识与完成

  function setTarget(t) {
    if (target === t) return;
    if (target) target.classList.remove('coach-target');
    target = t || null;
    if (target) target.classList.add('coach-target');
  }
  function applyHL(st) {
    const R = ui.R;
    if (R.hl && R.hl.tutorial) R.setHighlight(null);
    const spec = st.hl ? st.hl() : null;
    if (spec) R.setHighlight(Object.assign({ dur: 1e9, tutorial: true }, spec));
  }
  function go(i) {
    idx = U.clamp(i, 0, STEPS.length - 1);
    g.tutorial.step = idx;
    doneAt = 0; ctx = {};
    const st = STEPS[idx];
    if (st.enter) st.enter();
    applyHL(st);
    if (st.final) { g.tutorial.complete = true; snd('fanfare'); }
    ui.markUnsaved(); ui.scheduleAutosave();
    render();
  }
  function complete() {
    if (doneAt) return;
    const st = STEPS[idx];
    doneAt = performance.now();
    if (g.tutorial.done.indexOf(st.id) < 0) g.tutorial.done.push(st.id);
    snd('good');
    render();
  }
  function render() {
    if (!el) return;
    const st = STEPS[idx], n = idx, ok = !!doneAt;
    el.className = 'hud glass' + (mini ? ' mini' : '') + (ok ? ' ok' : '');
    el.innerHTML = '';
    const pct = Math.round(Math.min(n, TASKS + 1) / (TASKS + 1) * 100);
    const head = h('div', { class: 'co-head' },
      h('span', { class: 'co-badge' }, ic('help', 14), '新手教程'),
      h('span', { class: 'co-step' }, st.final ? '全部完成' : (st.info ? '小知识 · 可跳过' : (n === 0 ? '共 ' + TASKS + ' 个任务' : '任务 ' + n + ' / ' + TASKS))),
      h('span', { class: 'grow' }),
      h('button', { class: 'iconbtn', 'data-tip': mini ? '展开' : '收起', onclick: function () { mini = !mini; render(); } }, ic(mini ? 'expand' : 'minus')));
    el.append(head, h('div', { class: 'co-bar' }, h('i', { style: { width: pct + '%' } })));
    if (mini) { el.appendChild(h('div', { class: 'co-mini' }, ok ? '✓ ' : '', st.title)); syncLayout(); return; }
    el.appendChild(h('div', { class: 'co-title' }, ok ? h('span', { class: 'co-check' }, ic('check', 16)) : null, st.title));
    el.appendChild(h('div', { class: 'co-body' }, st.body));
    if (st.hint && !ok) el.appendChild(h('div', { class: 'co-hint' }, ic('info', 14), h('span', null, st.hint)));
    const acts = h('div', { class: 'co-acts' });
    if (st.final) {
      acts.append(
        h('button', { class: 'btn sm ghost', onclick: function () { ui.showEconGuide(); } }, '回看财政知识'),
        h('button', { class: 'btn sm', onclick: function () { Tutorial.detach(); ui.toast('教程已完成，可以继续在青湾自由建设', 'good'); } }, '继续在青湾建设'),
        h('button', { class: 'btn sm primary', onclick: function () { ui.backToMenu(function () { ui.showMapSelect('gz'); }); } }, '去广州开始游戏', ic('chev', 14)));
    } else if (st.info) {
      acts.append(h('button', { class: 'btn sm ghost', onclick: function () { go(idx - 1); } }, '上一步'), h('span', { class: 'grow' }), h('button', { class: 'btn sm ghost', onclick: function () { go(idx + 1); } }, '跳过'),
        h('button', { class: 'btn sm primary', onclick: function () { ui.showEconGuide(function () { if (STEPS[idx] === st) go(idx + 1); }); } }, '图文说明', ic('chev', 14)));
    } else if (st.manual) {
      acts.append(h('button', { class: 'btn sm ghost', onclick: function () { Tutorial.detach(true); } }, '退出教程'), h('span', { class: 'grow' }), h('button', { class: 'btn sm primary', onclick: function () { go(idx + 1); } }, st.manual, ic('chev', 14)));
    } else {
      acts.append.apply(acts, [
        h('button', { class: 'btn sm ghost', disabled: idx <= 1 ? true : null, onclick: function () { go(idx - 1); } }, '上一步'),
        h('span', { class: 'grow' }),
        ok ? h('span', { class: 'co-done' }, '完成！') : h('button', { class: 'btn sm ghost', onclick: function () { go(idx + 1); } }, '跳过'),
        ok ? h('button', { class: 'btn sm primary', onclick: function () { go(idx + 1); } }, '下一步', ic('chev', 14)) : null].filter(Boolean));
    }
    el.appendChild(acts);
    syncLayout();
  }
  // 引导卡片与图层图例共用左上角：图例排在卡片下方
  function syncLayout() {
    if (!el) return;
    requestAnimationFrame(function () { if (el) document.documentElement.style.setProperty('--coach-h', el.offsetHeight + 'px'); });
  }

  const Tutorial = {
    attach: function (u, game) {
      ui = u; g = game;
      if (!g.tutorial) return;
      Tutorial.detach();
      ui = u; g = game;
      // 1.7 前完成的存档：完成步序号为 STEPS.length - 2。
      if (g.tutorial.complete && g.tutorial.step >= STEPS.length - 2) {
        ui.toast('教程已完成，可以继续在青湾自由建设', 'info');
        return;
      }
      el = h('aside', { id: 'coach' });
      document.getElementById('app').appendChild(el);
      document.body.classList.add('has-coach');
      if (ui.placeFeed) ui.placeFeed();
      mini = false;
      go(g.tutorial.step || 0);
    },
    // quit：玩家主动退出教程（保留城市，可继续自由建设）
    detach: function (quit) {
      if (quit && g && g.tutorial) { g.tutorial.complete = true; g.tutorial.step = STEPS.length - 1; if (ui) { ui.markUnsaved(); ui.toast('已退出教程，可以继续在青湾自由建设', 'info'); } }
      setTarget(null);
      if (ui && ui.R.hl && ui.R.hl.tutorial) ui.R.setHighlight(null);
      if (el) { el.remove(); el = null; }
      document.body.classList.remove('has-coach');
      if (ui && ui.placeFeed) ui.placeFeed();
      idx = -1;
    },
    active: function () { return !!el; },
    tick: function () {
      if (!el || !g || CM.game !== g || idx < 0) return;
      const st = STEPS[idx];
      const now = performance.now();
      // 目标按钮闪烁（打开全屏界面时暂停）
      setTarget(!doneAt && st.target && !ui.blocking() ? st.target() : null);
      if (doneAt) { if (now - doneAt > 1400) go(idx + 1); return; }
      if (!st.check || now - lastCheck < 250) return;
      lastCheck = now;
      let ok = false;
      try { ok = st.check(); } catch (e) { ok = false; }
      if (ok) complete();
    },
  };
  CM.Tutorial = Tutorial;
})(window.CM);
