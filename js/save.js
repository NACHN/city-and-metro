'use strict';
// 本地存档（无账号）：存档数据保存在浏览器 IndexedDB（容量大），不可用时退回 localStorage；
// 存档索引保存在 localStorage。支持多进度、自动/手动存档、文件导入导出（格式、版本、校验和检查）。
(function (CM) {
  const U = CM.U, CFG = CM.CFG;
  const P = CFG.saves.prefix;
  const IDX = P + 'index';

  // ---------------- 存储后端 ----------------
  let db = null, dbFailed = false;
  function openDB() {
    if (db || dbFailed) return Promise.resolve(db);
    return new Promise(function (resolve) {
      let req;
      try { req = indexedDB.open('city-metro', 1); } catch (e) { dbFailed = true; resolve(null); return; }
      req.onupgradeneeded = function () { req.result.createObjectStore('slots'); };
      req.onsuccess = function () { db = req.result; resolve(db); };
      req.onerror = function () { dbFailed = true; resolve(null); };
      req.onblocked = function () { dbFailed = true; resolve(null); };
    });
  }
  function idbOp(mode, fn) {
    return openDB().then(function (d) {
      if (!d) throw new Error('IndexedDB 不可用');
      return new Promise(function (resolve, reject) {
        const tx = d.transaction('slots', mode);
        const st = tx.objectStore('slots');
        let result;
        const r = fn(st);
        if (r) r.onsuccess = function () { result = r.result; };
        tx.oncomplete = function () { resolve(result); };
        tx.onerror = function () { reject(tx.error || new Error('IndexedDB 写入失败')); };
        tx.onabort = function () { reject(tx.error || new Error('IndexedDB 事务中止')); };
      });
    });
  }
  const store = {
    put: function (key, str) {
      return idbOp('readwrite', function (st) { return st.put(str, key); }).then(function () { return 'idb'; })
        .catch(function (e) { if (db) throw e; localStorage.setItem(key, str); return 'ls'; });
    },
    get: function (key, where) {
      if (where === 'ls') return Promise.resolve(localStorage.getItem(key));
      return idbOp('readonly', function (st) { return st.get(key); })
        .then(function (v) { return v != null ? v : localStorage.getItem(key); }, function () { return localStorage.getItem(key); });
    },
    del: function (key, where) {
      try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
      if (where === 'ls') return Promise.resolve();
      return idbOp('readwrite', function (st) { return st.delete(key); }).catch(function () { /* ignore */ });
    },
  };

  function emptyIndex() { return { games: {}, slots: {} }; }
  function readIndex() {
    try {
      const s = localStorage.getItem(IDX);
      if (!s) return emptyIndex();
      const o = JSON.parse(s);
      return o && o.games && o.slots ? o : emptyIndex();
    } catch (e) { return emptyIndex(); }
  }
  function writeIndex(idx) { localStorage.setItem(IDX, JSON.stringify(idx)); }
  function errMsg(e) {
    if (!e) return '未知错误';
    if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) return '浏览器本地存储空间不足（可删除旧存档或导出备份后清理）';
    if (e.name === 'SecurityError') return '浏览器禁止本地存储（隐私模式或站点数据被阻止）';
    return e.message || String(e);
  }

  const Save = {};
  let writeTail = Promise.resolve(), writeSeq = 0, lastSavedAt = 0;
  function queueWrite(work) {
    const next = writeTail.then(work);
    writeTail = next.then(function () {}, function () {});
    return next;
  }
  function uniqueWriteId() { return U.uid('') + '-' + (++writeSeq).toString(36); }
  // 同一时钟刻度内也按写入顺序排序，确保自动轮换及「最近存档」正确。
  function savedAt(requested) { lastSavedAt = Math.max(Date.now(), requested || 0, lastSavedAt + 1); return lastSavedAt; }
  Save.init = function () { return openDB(); };
  Save.backend = function () { return db ? 'IndexedDB' : 'localStorage'; };
  Save.available = function () {
    try { const k = P + '__t'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch (e) { return false; }
  };
  Save.envelope = function (game) {
    const body = JSON.stringify(game.serialize());
    return { format: CFG.SAVE_FORMAT, version: CFG.SAVE_VERSION, gameVersion: CFG.GAME_VERSION, savedAt: Date.now(), checksum: U.fnv(body), body: body };
  };
  // kind: 'auto' | 'manual'；opts: { slotId（覆盖）, label }。返回 Promise<{ok, error, slotId}>
  Save.save = function (game, kind, opts) {
    opts = Object.assign({}, opts);
    let env;
    try { env = Save.envelope(game); } catch (e) { return Promise.resolve({ ok: false, error: '序列化失败：' + errMsg(e) }); }
    // 请求时即冻结快照及索引摘要；排队期间时间推进、切图或改名不改写本次快照。
    const snap = { id: game.id, name: game.name, mode: game.mode, map: game.mapId || 'gz', createdAt: game.createdAt,
      date: [game.clock.y, game.clock.m, game.clock.d], stations: game.compiled.stations.length, funds: game.econ.isFree() ? null : game.econ.funds };
    return queueWrite(function () {
      const idx = readIndex(); let slotId = opts.slotId;
      if (kind === 'auto') {
        const a1 = idx.slots[snap.id + '.a1'], a2 = idx.slots[snap.id + '.a2'];
        slotId = !a1 ? snap.id + '.a1' : (!a2 ? snap.id + '.a2' : (a1.savedAt <= a2.savedAt ? snap.id + '.a1' : snap.id + '.a2'));
      } else if (!slotId || !idx.slots[slotId]) {
        const manual = Object.values(idx.slots).filter(function (s) { return s.gameId === snap.id && s.kind === 'manual'; });
        if (manual.length >= CFG.saves.maxManual) return { ok: false, error: '该进度的手动存档已达上限（' + CFG.saves.maxManual + ' 个），请覆盖或删除旧存档' };
        slotId = snap.id + '.m' + uniqueWriteId();
      }
      const old = idx.slots[slotId];
      if (old && old.gameId !== snap.id) return { ok: false, error: '不能覆盖其他进度的存档' };
      const key = P + 'slot.' + slotId + '.' + uniqueWriteId();
      env.savedAt = savedAt(env.savedAt); const str = JSON.stringify(env);
      const meta = { slotId: slotId, key: key, gameId: snap.id, kind: kind, label: opts.label || (kind === 'auto' ? '自动存档' : '手动存档'),
        date: snap.date, savedAt: env.savedAt, size: str.length, mode: snap.mode, name: snap.name, map: snap.map, stations: snap.stations, funds: snap.funds };
      // 写入串行化，使额度、轮换和覆盖均依据上一次已提交的索引；失败不覆盖旧数据。
      return store.put(key, str).then(function (where) {
        return store.get(key, where).then(function (back) {
          if (back !== str) { store.del(key, where); return { ok: false, error: '写入后校验失败' }; }
          const idx2 = readIndex();
          idx2.games[snap.id] = { gameId: snap.id, name: snap.name, mode: snap.mode, map: snap.map, createdAt: snap.createdAt, updatedAt: env.savedAt };
          meta.store = where; idx2.slots[slotId] = meta;
          try { writeIndex(idx2); }
          catch (e) { store.del(key, where); return { ok: false, error: errMsg(e) }; }
          if (old && old.key && old.key !== key) store.del(old.key, old.store);
          return { ok: true, slotId: slotId, savedAt: env.savedAt, size: str.length };
        });
      });
    }).catch(function (e) { return { ok: false, error: errMsg(e) }; });
  };
  // mapId：只列出该地图的进度（不传则列出全部）
  Save.list = function (mapId) {
    const idx = readIndex();
    const games = Object.values(idx.games).filter(function (g) { return !mapId || (g.map || 'gz') === mapId; }).map(function (g) {
      const slots = Object.values(idx.slots).filter(function (s) { return s.gameId === g.gameId; }).sort(function (a, b) { return b.savedAt - a.savedAt; });
      return Object.assign({}, g, { slots: slots, latest: slots[0] ? slots[0].savedAt : 0 });
    }).filter(function (g) { return g.slots.length; });
    games.sort(function (a, b) { return b.latest - a.latest; });
    return games;
  };
  Save.latest = function (mapId) {
    const g = Save.list(mapId)[0];
    return g ? g.slots[0] : null;
  };
  Save.parseEnvelope = function (text) {
    let env;
    try { env = JSON.parse(text); } catch (e) { throw new Error('文件不是有效的存档（JSON 解析失败）'); }
    if (!env || env.format !== CFG.SAVE_FORMAT) throw new Error('文件格式不正确：不是《城市与地铁》存档');
    if (typeof env.version !== 'number' || env.version > CFG.SAVE_VERSION) throw new Error('存档版本（' + env.version + '）高于当前游戏支持的版本（' + CFG.SAVE_VERSION + '），无法导入');
    if (env.version < CFG.SAVE_MIN_VERSION) throw new Error('该存档来自 1.0 版（旧示意地图）。1.1 版起改用真实的广州地理，旧存档的城市数据无法对应，请开始新游戏。');
    if (typeof env.body !== 'string' || U.fnv(env.body) !== env.checksum) throw new Error('存档校验失败：文件可能已损坏或被修改');
    let payload;
    try { payload = JSON.parse(env.body); } catch (e) { throw new Error('存档内容损坏'); }
    const ok = payload && payload.meta && payload.clock && payload.city && payload.net && payload.econ && payload.tasks;
    if (!ok) throw new Error('存档缺少必要数据');
    // 存档所属地图（1.4 版之前的存档都是广州）：按该地图的网格尺寸校验
    const mp = CM.MAPS && CM.MAPS[payload.meta.map || 'gz'];
    if (!mp) throw new Error('存档使用的地图「' + payload.meta.map + '」在当前版本中不存在');
    // 地图数据版本：缺省为 1（1.4 版及更早的广州 / 青湾存档）。存档版本高于当前地图数据时拒绝载入；
    // 低于当前版本时按地图登记的迁移函数处理（迁移只作用于解析出的副本，失败时原存档不受影响）
    const mv = payload.meta.mapVersion || 1;
    if (mv > mp.mapVersion) throw new Error('存档使用的「' + mp.name + '」地图数据为第 ' + mv + ' 版，高于当前游戏的第 ' + mp.mapVersion + ' 版，请更新游戏后再载入');
    if (mv < (mp.minVersion || 1)) throw new Error('存档的「' + mp.name + '」地图数据版本（第 ' + mv + ' 版）过旧，当前版本无法兼容');
    if (mv < mp.mapVersion) {
      if (!mp.migrate) throw new Error('「' + mp.name + '」地图数据已从第 ' + mv + ' 版更新到第 ' + mp.mapVersion + ' 版，且没有可用的迁移方法');
      try { mp.migrate(payload, mv); payload.meta.mapVersion = mp.mapVersion; } catch (e) { throw new Error('存档迁移失败（' + (e && e.message || e) + '），原存档未改动'); }
    }
    for (const k of ['pop', 'jobs', 'bh', 'taken', 'lu', 'street', 'urbanYear']) {
      const a = payload.city[k];
      if (!a || !a.b || a.n !== mp.cfg.W * mp.cfg.H) throw new Error('城市数据不完整或尺寸不符');
    }
    return { env: env, payload: payload };
  };
  function readSlotText(slotId) {
    const meta = readIndex().slots[slotId];
    if (!meta) return Promise.reject(new Error('存档不存在'));
    return store.get(meta.key, meta.store).then(function (text) {
      if (!text) throw new Error('存档数据丢失（浏览器数据可能已被清理）');
      return { meta: meta, text: text };
    });
  }
  // 进度重命名保存在索引中，不重写每个历史快照；读取与导出时将最新名称应用到副本。
  function parseSlot(r) {
    const parsed = Save.parseEnvelope(r.text);
    if (typeof r.meta.name === 'string' && parsed.payload.meta.name !== r.meta.name) {
      parsed.payload.meta.name = r.meta.name;
      parsed.env.body = JSON.stringify(parsed.payload);
      parsed.env.checksum = U.fnv(parsed.env.body);
    }
    return parsed;
  }
  // 载入：旧交通模型的存档（v1.8 及更早）在升级前先把原始存档另存为「升级前备份」（只建一次，不计入手动存档上限），
  // 备份失败时仍可载入，但不自动保存升级后的进度（见 main.js），原存档不受影响
  Save.load = function (slotId) {
    return readSlotText(slotId).then(function (r) {
      const p = parseSlot(r).payload;
      const tv = (p.traffic && p.traffic.v) || 1;
      if (tv >= (CFG.TRAFFIC_MODEL || 1) || r.meta.kind === 'backup') return p;
      return Save.backupBeforeUpgrade(r, p).then(function (res) {
        if (res.ok) p.__backupSlot = res.slotId; else p.__backupFailed = res.error || '未知错误';
        return p;
      });
    });
  };
  Save.backupBeforeUpgrade = function (r, payload) {
    let env = null; try { env = JSON.parse(r.text); } catch (e) { return Promise.resolve({ ok: false, error: '存档内容无法解析' }); }
    const meta = r.meta, from = (payload.meta && payload.meta.gameVersion) || env.gameVersion || '1.8.0';
    const slotId = meta.gameId + '.bk' + String(env.savedAt || meta.savedAt || 0);
    return queueWrite(function () {
      const idx = readIndex();
      if (idx.slots[slotId]) return { ok: true, slotId: slotId, existed: true };
      const key = P + 'slot.' + slotId + '.' + uniqueWriteId(), text = r.text;
      return store.put(key, text).then(function (where) {
        return store.get(key, where).then(function (back) {
          if (back !== text) { store.del(key, where); return { ok: false, error: '备份写入后校验失败' }; }
          const idx2 = readIndex();
          idx2.slots[slotId] = Object.assign({}, meta, { slotId: slotId, key: key, store: where, kind: 'backup', label: '升级前备份（v' + from + '）', savedAt: meta.savedAt, size: text.length });
          if (!idx2.games[meta.gameId]) idx2.games[meta.gameId] = { gameId: meta.gameId, name: meta.name, mode: meta.mode, map: meta.map, createdAt: payload.meta.createdAt, updatedAt: meta.savedAt };
          try { writeIndex(idx2); } catch (e) { store.del(key, where); return { ok: false, error: errMsg(e) }; }
          return { ok: true, slotId: slotId };
        });
      });
    }).catch(function (e) { return { ok: false, error: errMsg(e) }; });
  };
  Save.remove = function (slotId) {
    const idx = readIndex();
    const meta = idx.slots[slotId];
    if (!meta) return;
    delete idx.slots[slotId];
    if (!Object.values(idx.slots).some(function (s) { return s.gameId === meta.gameId; })) delete idx.games[meta.gameId];
    writeIndex(idx);
    store.del(meta.key, meta.store);
  };
  Save.removeGame = function (gameId) {
    const idx = readIndex();
    for (const s of Object.values(idx.slots)) if (s.gameId === gameId) { delete idx.slots[s.slotId]; store.del(s.key, s.store); }
    delete idx.games[gameId];
    writeIndex(idx);
  };
  Save.rename = function (gameId, name) {
    const idx = readIndex();
    if (!idx.games[gameId]) return;
    idx.games[gameId].name = name;
    for (const s of Object.values(idx.slots)) if (s.gameId === gameId) s.name = name;
    writeIndex(idx);
  };
  Save.fileName = function (meta) {
    const d = meta.date || [0, 0];
    return '城市与地铁_' + (meta.name || '存档').replace(/[\\/:*?"<>|]/g, '_') + '_' + d[0] + '年' + d[1] + '月.cmsave.json';
  };
  Save.download = function (text, filename) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  };
  Save.exportSlot = function (slotId) {
    return readSlotText(slotId).then(function (r) { Save.download(JSON.stringify(parseSlot(r).env), Save.fileName(r.meta)); });
  };
  Save.exportGame = function (game) {
    const env = Save.envelope(game);
    Save.download(JSON.stringify(env), Save.fileName({ name: game.name, date: [game.clock.y, game.clock.m] }));
  };
  // 导入：校验通过后作为新的手动存档保存，不覆盖已有进度。返回 Promise
  Save.importText = function (text) {
    let r;
    try { r = Save.parseEnvelope(text); } catch (e) { return Promise.reject(e); }
    return queueWrite(function () {
      const idx = readIndex();
      const p = r.payload;
      let gameId = p.meta.gameId, name = p.meta.name;
      if (idx.games[gameId]) { gameId = U.uid('g'); name = name + '（导入）'; p.meta.gameId = gameId; p.meta.name = name; }
      const body = JSON.stringify(p);
      const env = { format: CFG.SAVE_FORMAT, version: CFG.SAVE_VERSION, gameVersion: CFG.GAME_VERSION, savedAt: savedAt(), checksum: U.fnv(body), body: body };
      const str = JSON.stringify(env);
      const slotId = gameId + '.m' + uniqueWriteId();
      const key = P + 'slot.' + slotId + '.' + uniqueWriteId();
      return store.put(key, str).then(function (where) {
        const idx2 = readIndex();
        idx2.games[gameId] = { gameId: gameId, name: name, mode: p.meta.mode, map: p.meta.map || 'gz', createdAt: p.meta.createdAt, updatedAt: env.savedAt };
        idx2.slots[slotId] = { slotId: slotId, key: key, store: where, gameId: gameId, kind: 'manual', label: '导入的存档', date: [p.clock.y, p.clock.m, p.clock.d], savedAt: env.savedAt, size: str.length, mode: p.meta.mode, map: p.meta.map || 'gz', name: name, stations: Object.keys(p.net.stations || {}).length, funds: p.econ.isFree() ? null : p.econ.funds };
        try { writeIndex(idx2); } catch (e) { store.del(key, where); throw new Error(errMsg(e)); }
        return { slotId: slotId, gameId: gameId, name: name, map: p.meta.map || 'gz' };
      }, function (e) { throw new Error(errMsg(e)); });
    });
  };
  Save.usage = function () {
    let n = 0;
    for (const s of Object.values(readIndex().slots)) n += s.size || 0;
    return n;
  };
  CM.Save = Save;
})(window.CM);
