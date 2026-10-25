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
      console.log('  判读：① <45 fps 或最长帧 >50 ms → 渲染/月刷新有问题；② 求解 >800 ms → 求解太慢');
    });
  });
})();
