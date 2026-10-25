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

  // 1) 求解一轮
  let t0 = T(); model.solveNow(1); const one = T() - t0;
  // 2) 连跑两轮（近似「改线后重新收敛」）
  t0 = T(); model.solveNow(2); const two = T() - t0;

  // 3) 内存（仅 Chrome / Edge 支持 performance.memory）
  const m = performance.memory;
  const mem = m ? (m.usedJSHeapSize / 1048576).toFixed(1) + ' MB（堆）· ' + (m.jsHeapSizeLimit / 1048576).toFixed(0) + ' MB 上限'
                : '这个浏览器不暴露 performance.memory（Safari / Firefox 正常）';

  // 4) 帧率：3 秒采样
  let frames = 0, last = T(), worst = 0;
  const start = T();
  const tick = function () {
    const now = T(); const dt = now - last; last = now;
    if (frames > 2) worst = Math.max(worst, dt);
    frames++;
    if (now - start < 3000) requestAnimationFrame(tick);
    else {
      const fps = frames / ((now - start) / 1000);
      console.log('%c《城市与地铁》性能探针', 'font-weight:bold;color:#1D9E75');
      console.log('  地图：' + CM.mapId + ' · 小区 ' + model.Z + ' · 人口 ' + Math.round(model.city.totals().pop).toLocaleString());
      console.log('  求解一轮：' + fmt(one) + ' · 连跑两轮：' + fmt(two));
      console.log('  3 秒平均帧率：' + fps.toFixed(1) + ' fps（最长一帧 ' + fmt(worst) + '）');
      console.log('  内存：' + mem);
      console.log('  提示：如果「求解一轮」> 800 ms，或帧率 < 30，把上面三行发回给我');
    }
  };
  requestAnimationFrame(tick);
})();
