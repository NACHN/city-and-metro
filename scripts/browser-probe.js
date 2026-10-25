// 浏览器实测探针（在游戏页面打开后，把本文件内容粘到 DevTools Console 里回车）
//
// 会打印：求解一轮的耗时、当前内存（Chrome 的 performance.memory）、3 秒内的帧率、
// 以及「改动后重新收敛」的耗时（调用 solveNow(2) 的近似）。
// 只读取与调用公开接口，不改变游戏状态（solveNow 会推进求解，但结果与等待一段时间等价）。
(function () {
  const CM = window.CM;
  const g = CM.game || null;
  const model = g ? g.model : null;
  if (!CM || !model) { console.warn('找不到 CM / 当前对局，请在游戏进行中运行'); return; }
  const T = function () { return performance.now(); };
  const fmt = function (v, u) { return v.toFixed(v < 10 ? 2 : 0) + (u || ' ms'); };

  // ① 先测「纯游玩」的帧率——不要先跑 solve，否则测到的是自己的阻塞
  const sample = function (ms, done) {
    let frames = 0, worst = 0, last = T(), t0 = T();
    const tick = function () {
      const now = T(); const dt = now - last; last = now;
      if (frames > 2) worst = Math.max(worst, dt);
      frames++;
      if (now - t0 < ms) requestAnimationFrame(tick);
      else done(frames / ((now - t0) / 1000), worst);
    };
    requestAnimationFrame(tick);
  };

  sample(3000, function (fps, worst) {
    // ② 再测求解耗时（这一段会阻塞，所以放在帧率采样之后）
    let t0 = T(); model.solveNow(1); const one = T() - t0;
    t0 = T(); model.solveNow(2); const two = T() - t0;
    // ③ 再采一次帧率，这次包含「求解刚结束」的影响（GC / 重排）
    sample(2000, function (fps2, worst2) {
      const m = performance.memory;
      const mem = m ? (m.usedJSHeapSize / 1048576).toFixed(1) + ' MB（堆）' : '该浏览器不暴露 performance.memory';
      console.log('%c《城市与地铁》性能探针', 'font-weight:bold;color:#1D9E75');
      console.log('  地图 ' + CM.mapId + ' · 小区 ' + model.Z + ' · 人口 ' + Math.round(model.city.totals().pop).toLocaleString() +
        ' · OD 记录 ' + (model.od ? model.od.dest.length : 0));
      console.log('  游玩帧率：' + fps.toFixed(1) + ' fps（最长一帧 ' + fmt(worst) + '）');
      console.log('  求解一轮：' + fmt(one) + ' · 连跑两轮：' + fmt(two));
      console.log('  求解后帧率：' + fps2.toFixed(1) + ' fps（最长一帧 ' + fmt(worst2) + '）');
      console.log('  内存：' + mem);
      // ④ 拆开看：渲染一帧 vs 模拟一步各占多少（各跑 20 次取平均）
      const timeIt = function (fn, n) { const t0 = T(); for (let i = 0; i < n; i++) fn(); return (T() - t0) / n; };
      let renderMs = -1, simMs = -1;
      try { if (CM.R && CM.R.render) renderMs = timeIt(function () { CM.R.render(0.016, CM.ui); }, 20); } catch (e) { }
      try { if (model.step) simMs = timeIt(function () { model.step(1); }, 20); } catch (e) { }
      console.log('  渲染一帧：' + (renderMs >= 0 ? fmt(renderMs) : '—') +
        ' · 模拟一步：' + (simMs >= 0 ? fmt(simMs) : '—') +
        ' · 二者之和占一帧的比例：' + (renderMs >= 0 && simMs >= 0 && fps > 0 ? Math.round((renderMs + simMs) / (1000 / fps) * 100) + '%' : '—'));
      // ⑤ 逐项拆解主循环（dt=0 调用，不推进时间；只测耗时）
      const cost = {};
      const tryCost = function (name, fn) {
        try { cost[name] = timeIt(fn, 20); } catch (e) { cost[name] = -1; }
      };
      tryCost('g.update', function () { g.update(0); });
      tryCost('agents', function () { CM.agents && CM.agents.update(0, g, CM.R); });
      tryCost('follow', function () { CM.Follow && CM.Follow.tick(0); });
      tryCost('tutorial', function () { CM.Tutorial && CM.Tutorial.tick(0); });
      tryCost('tools.tick', function () { CM.tools && CM.tools.tick(0); });
      tryCost('R.render', function () { CM.R.render(0, CM.ui); });
      tryCost('sound', function () { CM.Soundscape && CM.Soundscape.tick(0); });
      tryCost('ui.tick', function () { CM.ui && CM.ui.tick(0); });
      const rows = Object.keys(cost).filter(function (k) { return cost[k] >= 0; });
      rows.sort(function (a, b) { return cost[b] - cost[a]; });
      console.log('  逐项（各 20 次平均）：' + rows.map(function (k) { return k + ' ' + fmt(cost[k]); }).join(' · '));
      const sum = rows.reduce(function (a, k) { return a + cost[k]; }, 0);
      console.log('  合计 ' + fmt(sum) + ' · 一帧预算 ' + fmt(1000 / Math.max(1, fps)) +
        ' · 未计入 ' + fmt(Math.max(0, 1000 / Math.max(1, fps) - sum)) + '（合成/GC/浏览器自身）');
      console.log('  判读：① <45 fps 或最长帧 >50 ms → 看「渲染一帧」占比；② 求解 >800 ms → 求解太慢');
    });
  });
})();
