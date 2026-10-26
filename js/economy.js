'use strict';
// 经营：资金、拨款、票款、运营费用、满意度、失败判定；任务：历史参考任务与动态任务
(function (CM) {
  const U = CM.U, CFG = CM.CFG, D = CM.DATA;

  // 月度账本。科目严格区分：
  //   财政收入 grant 拨款 · fare 票款 · reward 任务奖励
  //   融资到账 bond（债券募集，进入建设专项资金，不算收入）
  //   建设支出 construction · demolition · upgrade · relocation（其中 capexUse 为专项资金支付的部分）
  //   运营成本 ops · 利息 interest · 本金偿还 principal · 逾期费用 penalty
  function blankMonth(y, m, funds, capex) {
    // 物业科目（property / propMaint）按需生成，不预置零值：旧模式的账本序列化保持不变
    return { y: y, m: m, start: funds, grant: 0, fare: 0, construction: 0, demolition: 0, upgrade: 0, relocation: 0, ops: 0, reward: 0,
      bond: 0, interest: 0, principal: 0, penalty: 0, capexUse: 0, capexStart: capex || 0, days: 0, wdDays: 0, weDays: 0, end: funds };
  }
  // land 是场站用地（D7）：与拆迁并列的第二笔土地账。它按需生成、不进 blankMonth，
  // 所以没有用地支出的月份序列化保持不变（既有存档与指纹不受影响）。
  const BUILD_KINDS = ['construction', 'demolition', 'upgrade', 'relocation', 'land'];
  const MONEY_EPS = 1e-7;   // 内部单位是万元；只忽略浮点误差，不能把不足 0.5 万的真实债务清零
  Economy.BUILD_KINDS = BUILD_KINDS;
  Economy.MONEY_EPS = MONEY_EPS;

  // caps 可选：新体系下由 CM.capsFor(preset, systems) 算好传进来；
  // 不传则退回旧模式表（CM.modeCaps），保证旧存档与旧入口行为不变。
  function Economy(mode, y, m, caps) {
    this.mode = mode;
    this.caps = caps || CM.modeCaps(mode);   // 能力标志：见 config.js 的 CM.SYSTEMS / CM.MODES
    this.funds = this.caps.budget ? CFG.economy.startFunds : 0;   // 一般资金（拨款、票款等；运营、利息与还本只能从这里支付）
    this.capex = 0;            // 建设专项资金：债券募集，只能用于地铁建设及改扩建
    this.bonds = [];           // 已发行的债券
    this.bondIssued = {};      // 每年已发行额 { 年份: { local, ct } }
    this.overdue = 0;          // 逾期未付的本息
    this.overdueMonths = 0;    // 连续存在逾期的月数
    this.overdueParts = { interest: 0, principal: 0, penalty: 0 };   // 逾期的构成（偿还时分别记入利息、本金、费用）
    this.flow = [];            // 资金流水
    this.bondSeq = 1;
    this.fare = Object.assign({}, CFG.fareDefault);
    this.cur = blankMonth(y, m, this.funds, 0);
    this.ledger = [];
    this.sat = CFG.economy.startSat;
    this.mods = [];
    this.negMonths = 0; this.lowSatMonths = 0;
    this.failed = null;
    this.lastDay = null;
    this.satFactors = null;
    this.fisc = null;          // 财力系数 { y, f }（城市经济每年 1 月设定）
    this.quoteFn = null;       // 新发债券的利率报价（城市经济提供；不保存）
    this.subsidyLevel = 'standard';   // 补贴力度（难度）：easy / standard / realistic
  }
  CM.Economy = Economy;

  // 资金不受限 = 没有预算约束。保留这个别名，调用点不必关心具体模式名
  Economy.prototype.isFree = function () { return !this.caps.budget; };
  // 只检查新增的现金支出：零费用操作（如拆除既有设施）在负余额时也允许，便于止损
  Economy.prototype.canAfford = function (amount) { return this.isFree() || amount <= MONEY_EPS || this.funds >= amount; };
  Economy.prototype.spend = function (kind, amount) {
    if (amount <= 0) return;
    this.cur[kind] = (this.cur[kind] || 0) + amount;
    if (!this.isFree()) this.funds -= amount;
  };
  Economy.prototype.income = function (kind, amount) {
    this.cur[kind] = (this.cur[kind] || 0) + amount;
    if (!this.isFree()) this.funds += amount;
  };
  // 价格指数以本地图的价格基年（CFG.econBase）为 1，涨幅可分段
  Economy.prototype.costIndex = function (year) { return U.priceIndex(year, CFG.cost.inflation, CFG.econBase || 1990); };
  Economy.prototype.opsIndex = function (year) { return U.priceIndex(year, CFG.ops.inflation, CFG.econBase || 1990); };

  // 每日结算：票款与运营费用，按当天的日类型（工作日 / 周末）的模拟结果逐日累计（v1.9 起；之前按典型工作日）
  Economy.prototype.day = function (daily, compiled, year, dt) {
    const fareWan = daily && daily.ready ? daily.fare / 10000 : 0;
    let ops = 0;
    if (daily && compiled) {
      const oi = this.opsIndex(year);
      ops += daily.carKm * CFG.ops.carKmCost * oi;
      for (const s of compiled.stations) ops += CFG.ops.stationDaily[s.size] * oi;
    }
    this.income('fare', fareWan);
    this.spend('ops', ops);
    // 运营补贴（批次模式）：按「当日运营成本 × 补贴率 × 满意度系数」结算。
    // 客均成本高的年代补贴自然多，成熟后自然回落——难度曲线是城市自己长出来的。
    if (this.batchOn() && ops > 0) {
      const sub = ops * this.subsidyRate() * (0.6 + 0.8 * this.sat / 100);
      this.income('grant', sub);
      this.cur.subsidy = (this.cur.subsidy || 0) + sub;
    }
    this.cur.days++;
    if (dt === 'we') this.cur.weDays = (this.cur.weDays || 0) + 1; else if (dt === 'wd') this.cur.wdDays = (this.cur.wdDays || 0) + 1;
    this.lastDay = { fare: fareWan, ops: ops, dt: dt || null };
  };

  // 拨款与满意度调整（mods）：until 为最后一个生效的月份（含当月），N 个月的效果记为 ym + N − 1
  // 财力系数（城市经济，macro.js）：上一年实际地方财政收入 ÷ 预期，每年 1 月确定一次；没有城市经济的地图为 1
  Economy.prototype.fiscalFactor = function () { return this.fisc && isFinite(this.fisc.f) ? this.fisc.f : 1; };
  // 基础额度：按城市与年代设定的地铁资金基数（不含财力、满意度与任务调整）
  Economy.prototype.grantQuota = function (y, m) {
    if (!this.batchOn()) return U.interp(CFG.economy.grantBase, y + ((m || 1) - 1) / 12);
    return 0;   // 批次模式下没有「月度固定拨款」：运营补贴按客流逐日结算（见 Economy.day）
  };
  // ---------------- 建设批次（D1，仅经营模式） ----------------
  // 把钱从「月流」改成「批次流」：每 4 年一次性给一个建设盘子，其余月份只有运营补贴。
  // 总量与逐年发放相当，但节奏从挤牙膏变成「一批开工若干个工地」——这是现实中地铁建设的真实节奏。
  // 配比 k 随城市成熟递减，所以后期的盘子跟着财政收入一起涨，能支撑一批几十公里。
  Economy.prototype.batchCfg = function () { return CFG.batch || null; };
  // 建设批次（客补模式）：独立开关，不再依赖「有没有地价」。
  // 旧模式表已显式写入 batch（tycoon=true、其余=false），所以行为与之前一致。
  Economy.prototype.batchOn = function () { return !!(CFG.batch && this.caps && this.caps.batch); };
  Economy.prototype.isBatchYear = function (y) { const B = this.batchCfg(); return !!(B && ((y - CFG.START.y) % (B.years || 4)) === 0); };
  // 票款自给率（近 12 个月票款 ÷ 运营成本）：下一批盘子的大小由它决定
  Economy.prototype.selfSufficiency = function () {
    const L = this.ledger;
    let fare = 0, ops = 0;
    for (let i = Math.max(0, L.length - 12); i < L.length; i++) { fare += L[i].fare || 0; ops += (L[i].ops || 0) + (L[i].facMaint || 0) + (L[i].busOps || 0); }
    return ops > 0.5 ? fare / ops : 0;
  };
  // 补贴率（难度）：政府承担多少运营成本。轻松 70% / 标准 50% / 现实 35%。
  // 补贴额 = 运营成本 × 补贴率 × 满意度系数，所以客均成本高时补得多、成熟后自然回落。
  Economy.prototype.subsidyRate = function () {
    // 新体系：补贴率由难度预设直接给出（0–1，按运营成本计）；旧模式表不带这个字段，继续读 CFG 的三档
    if (this.caps && typeof this.caps.subsidyRate === 'number') return this.caps.subsidyRate;
    const B = this.batchCfg();
    if (!B) return 0;
    return (B.subsidyRate && B.subsidyRate[this.subsidyLevel]) || (B.subsidyRate && B.subsidyRate.standard) || 0.5;
  };
  Economy.prototype.subsidyName = function () {
    const B = this.batchCfg();
    return (B && B.subsidyName && B.subsidyName[this.subsidyLevel]) || '标准';
  };
  // 年度资金盘子（万元/年）：有财政记录就用「上一年地方财政收入 × k」，没有就退回基数表
  Economy.prototype.annualQuota = function (y) {
    const B = this.batchCfg();
    if (!B) return U.interp(CFG.economy.grantBase, y) * 12;
    const rev = this.revOf ? this.revOf(y - 1) : 0;
    if (!(rev > 0)) return U.interp(CFG.economy.grantBase, y) * 12;
    return rev * U.interp(B.k, y) * (B.factor || 1);
  };
  // 本批建设资金（万元）：批次年的 1 月一次性到账，直接进建设专项资金
  Economy.prototype.batchFor = function (y) {
    const B = this.batchCfg();
    if (!B || !this.batchOn() || !this.isBatchYear(y)) return 0;
    const f = 0.6 + 0.8 * this.sat / 100, ym = U.ymIndex(y, 1);
    let mf = 1; for (const md of this.mods) if (md.kind === 'grant' && md.until >= ym) mf *= md.factor;
    return this.annualQuota(y) * (B.years || 4) * (B.buildFactor || 1) * f * Math.max(0.6, mf);
  };
  Economy.prototype.grantFor = function (y, m) {
    const ym = U.ymIndex(y, m);
    let f = 0.6 + 0.8 * this.sat / 100, mf = 1;
    for (const md of this.mods) if (md.kind === 'grant' && md.until >= ym) mf *= md.factor;
    // 批次模式：没有月度固定拨款，运营补贴按客流逐日结算
    if (this.batchOn()) return 0;
    return this.grantQuota(y, m) * this.fiscalFactor() * f * Math.max(0.6, mf);
  };
  Economy.prototype.grantFactors = function (y, m) {
    const ym = U.ymIndex(y, m);
    const list = [];
    if (this.batchOn()) {
      list.push({ label: '运营补贴率（' + this.subsidyName() + '）', f: this.subsidyRate(), kind: 'sub' });
    } else if (this.fisc) list.push({ label: '财力系数（' + (this.fisc.y || y) + ' 年预算）', f: this.fiscalFactor(), kind: 'fisc' });
    list.push({ label: '满意度系数（' + Math.round(this.sat) + '）', f: 0.6 + 0.8 * this.sat / 100, kind: 'sat' });
    for (const md of this.mods) if (md.kind === 'grant' && md.until >= ym) list.push({ label: md.reason + '（至 ' + Math.floor(md.until / 12) + '年' + (md.until % 12 + 1) + '月）', f: md.factor, kind: 'task' });
    return list;
  };
  // 新月份：先开新账（期初 = 上月期末），任务奖励等记入新月；再发放本月拨款
  Economy.prototype.openMonth = function (y, m) { this.cur = blankMonth(y, m, this.funds, this.capex); };
  Economy.prototype.payGrant = function (y, m) {
    if (this.isFree()) { this.cur.grant = 0; return; }
    // 批次模式：只有批次年的 1 月有建设资金；运营补贴在每日结算里按客流发（见 Economy.day）
    if (this.batchOn()) {
      const b = (m === 1) ? this.batchFor(y) : 0;
      if (b > 0) {
        this.income('grant', b);
        this.funds -= b; this.capex += b;
        this.cur.grantCapex = (this.cur.grantCapex || 0) + b;
        this.log('grant', b, 'gen', '建设批次（转入专项资金）', { y: y, m: m, d: 1 });
      }
      return;
    }
    const v = this.grantFor(y, m);
    this.income('grant', v);
    this.log('grant', v, 'gen', '政府拨款', { y: y, m: m, d: 1 });
  };
  Economy.prototype.startMonth = function (y, m) { this.openMonth(y, m); this.payGrant(y, m); };
  // 封账：记录期末并归档；之后的收支一律记入下一个月
  Economy.prototype.closeMonth = function () {
    this.cur.end = this.funds;
    this.cur.capexEnd = this.capex;
    this.cur.debtEnd = this.debtTotal();
    this.cur.overdueEnd = this.overdue;
    // 票款与运营费用逐日结算，在流水中按月汇总为两条
    if (!this.isFree()) {
      const c = this.cur, when = { y: c.y, m: c.m, d: U.daysInMonth(c.y, c.m) };
      if (c.fare > 0.5) this.log('fare', c.fare, 'gen', '本月票款（' + c.days + ' 天' + (c.wdDays || c.weDays ? '：' + (c.wdDays || 0) + ' 个工作日、' + (c.weDays || 0) + ' 个周末日' : '') + '）', when);
      if (c.ops > 0.5) this.log('ops', -c.ops, 'gen', '本月运营成本（' + c.days + ' 天）', when);
      if ((c.subsidy || 0) > 0.5) this.log('grant', c.subsidy, 'gen', '本月运营补贴（运营成本 × ' + Math.round(this.subsidyRate() * 100) + '%）', when);
    }
    this.cur.closed = true;
    this.ledger.push(this.cur);
    if (this.ledger.length > 600) this.ledger.shift();
    return this.cur;
  };

  // 满意度（0–100）：通勤、覆盖、拥堵、票价负担、拥挤。daily 为周平均日（5 个工作日 + 2 个周末日加权），
  // 通勤时间按工作日（model.dailyWk）；opts.protect：交通模型升级过渡期，满意度不下降
  Economy.prototype.updateSatisfaction = function (daily, model, y, m, opts) {
    if (!daily || !daily.ready) return;
    const vot = U.interp(CFG.choice.vot, y);
    const wk = model && model.dailyWk && model.dailyWk.ready ? model.dailyWk : daily;
    const f = [];
    f.push({ label: '平均通勤时间（工作日 ' + Math.round(wk.commute) + ' 分钟）', v: 14 * U.clamp((40 - wk.commute) / 15, -1, 1) });
    f.push({ label: '地铁覆盖（' + U.fmtPct(daily.coverage, 0) + ' 人口）', v: 12 * U.clamp(daily.coverage / 0.5, 0, 1) });
    f.push({ label: '道路拥堵（周平均指数 ' + daily.cong.toFixed(2) + '）', v: -14 * U.clamp((daily.cong - 1.25) / 0.8, 0, 1) });
    const burden = daily.metro > 1 ? daily.avgFare / (vot * 0.35) : 0;
    f.push({ label: '票价负担（平均 ' + daily.avgFare.toFixed(1) + ' ' + CFG.money.unit + '）', v: -9 * U.clamp((burden - 1) / 2, 0, 1) });
    f.push({ label: '车厢拥挤（周平均超载客公里 ' + U.fmtPct(daily.crowdShare, 0) + '）', v: -9 * U.clamp(daily.crowdShare / 0.25, 0, 1) });
    const ym = U.ymIndex(y, m);
    for (const md of this.mods) if (md.kind === 'sat' && md.until >= ym) f.push({ label: md.reason, v: md.delta });
    let target = 55;
    for (const x of f) target += x.v;
    target = U.clamp(target, 0, 100);
    const next = U.clamp(this.sat + (target - this.sat) * 0.25, 0, 100);
    const prot = !!(opts && opts.protect) && next < this.sat;
    this.sat = prot ? this.sat : next;
    this.satFactors = { base: 55, factors: f, target: target, basis: 'avg', protected: prot };
  };

  // 失败判定（仅经营挑战）。protect：交通模型升级过渡期，满意度不足的月数不累计
  Economy.prototype.checkFailure = function (y, protect) {
    if (this.isFree() || this.failed) return null;
    const E = CFG.economy;
    const limit = E.debtLimit * this.costIndex(y);
    this.negMonths = this.funds < 0 ? this.negMonths + 1 : 0;
    this.lowSatMonths = this.sat < E.satFail ? (protect ? this.lowSatMonths : this.lowSatMonths + 1) : 0;
    const reasons = [];
    if (this.funds < limit) reasons.push('资金低于负债下限（' + U.fmtMoney(this.funds) + '，下限 ' + U.fmtMoney(limit) + '）');
    if (this.negMonths >= E.negMonthsLimit) reasons.push('连续 ' + this.negMonths + ' 个月负余额（上限 ' + E.negMonthsLimit + ' 个月）');
    if (this.lowSatMonths >= E.satFailMonths) reasons.push('居民满意度连续 ' + this.lowSatMonths + ' 个月低于 ' + E.satFail + '，交通持续恶化');
    if (reasons.length) { this.failed = { reasons: reasons }; return this.failed; }
    return null;
  };
  Economy.prototype.warnings = function () {
    if (this.isFree()) return [];
    const E = CFG.economy, out = [];
    if (this.negMonths > 0) out.push({ level: this.negMonths >= E.negMonthsLimit * 0.6 ? 'danger' : 'warn', text: '财政预警：已连续 ' + this.negMonths + ' 个月负余额（满 ' + E.negMonthsLimit + ' 个月挑战失败）' });
    if (this.lowSatMonths > 0) out.push({ level: this.lowSatMonths >= E.satFailMonths * 0.6 ? 'danger' : 'warn', text: '交通预警：满意度已连续 ' + this.lowSatMonths + ' 个月低于 ' + E.satFail + '（满 ' + E.satFailMonths + ' 个月挑战失败）' });
    return out;
  };

  // ======================== 资金流水 ========================
  // kind：grant / fare / ops / reward / build / bond / interest / principal / penalty / overdue / repay；acct：gen 一般资金、capex 建设专项资金
  Economy.prototype.log = function (kind, amount, acct, note, when) {
    if (this.isFree()) return;
    const w = when || this._now || { y: this.cur.y, m: this.cur.m, d: 1 };
    this.flow.push({ y: w.y, m: w.m, d: w.d || 1, kind: kind, amount: amount, acct: acct, note: note, bal: this.funds, cap: this.capex });
    if (this.flow.length > 400) this.flow.splice(0, this.flow.length - 400);
  };

  // ======================== 建设支出：先用建设专项资金，不足部分用一般资金 ========================
  Economy.prototype.canAffordBuild = function (amount) { return this.isFree() || amount <= MONEY_EPS || Math.max(0, this.funds) + Math.max(0, this.capex) >= amount; };
  Economy.prototype.spendBuild = function (byKind, note, when) {
    let total = 0; for (const k of BUILD_KINDS) total += byKind[k] || 0;
    if (total <= 0) return { total: 0, capex: 0, gen: 0 };
    for (const k of BUILD_KINDS) if (byKind[k] > 0) this.cur[k] = (this.cur[k] || 0) + byKind[k];
    if (this.isFree()) return { total: total, capex: 0, gen: 0 };
    const use = Math.min(Math.max(0, this.capex), total), gen = total - use;
    this.capex -= use; this.funds -= gen; this.cur.capexUse = (this.cur.capexUse || 0) + use;
    if (use > 0.5) this.log('build', -use, 'capex', (note || '地铁建设') + '（专项资金）', when);
    if (gen > 0.5) this.log('build', -gen, 'gen', (note || '地铁建设') + (use > 0.5 ? '（专项不足部分）' : ''), when);
    return { total: total, capex: use, gen: gen };
  };

  // ======================== 债券融资（仅经营挑战） ========================
  // 地方债：利率较低、额度较大；城投债：利率较高、额度较小。利率在发行时按当年利率固定，6 年期另加期限溢价。
  // 年度发行额度与总债务上限按当年基础月拨款的倍数计算（随城市与年代变化），只能用于地铁建设及改扩建。
  const BOND_DEF = {
    local: { name: '地方债', desc: '由城市政府发行，利率较低、额度较大' },
    ct: { name: '城投债', desc: '由城市建设投资公司发行，利率较高、额度较小，有逾期时暂停发行' },
  };
  Economy.BOND_DEF = BOND_DEF;
  Economy.prototype.bondCfg = function () { return CFG.economy.bonds || null; };
  Economy.prototype.canBorrow = function () { return !this.isFree() && !!this.bondCfg(); };
  // 当年基础月拨款（含财力系数，不含满意度与任务调整）：融资额度与债务上限按此计算
  Economy.prototype.baseGrant = function (y) {
    if (this.batchOn()) return this.annualQuota(y) / 12;   // 批次模式下「月拨款」是年盘子的 1/12
    return U.interp(CFG.economy.grantBase, y) * this.fiscalFactor();
  };
  // 新发行债券的利率报价：有城市经济时按经济环境与财政状况浮动（macro.js）；已发行债券按合同利率，不受影响
  Economy.prototype.bondQuote = function (kind, y, term) {
    if (this.quoteFn) { try { const q = this.quoteFn(kind, y, term); if (q && isFinite(q.rate)) return q; } catch (e) { console.error(e); } }
    const B = this.bondCfg(); if (!B) return { rate: 0, parts: [] };
    const local = U.interp(B.local.rate, y);
    const parts = [{ k: 'base', label: '基准利率（' + y + ' 年市场水平）', v: local }];
    let r = local;
    if (kind === 'ct') { const sp = B.ct.rate ? U.interp(B.ct.rate, y) - local : (B.ct.spread || 0.015); parts.push({ k: 'ct', label: '城投债利差', v: sp }); r += sp; }
    if (term === 6) { const tp = B.term6 || 0.004; parts.push({ k: 'term', label: '6 年期期限溢价', v: tp }); r += tp; }
    return { rate: r, parts: parts };
  };
  Economy.prototype.bondRate = function (kind, y, term) { return this.bondQuote(kind, y, term).rate; };
  Economy.prototype.bondQuota = function (kind, y) { const B = this.bondCfg(); return B ? B[kind].quotaMonths * this.baseGrant(y) * this.bondScale() : 0; };
  Economy.prototype.bondCap = function (kind, y) { const B = this.bondCfg(); return B ? B[kind].capMonths * this.baseGrant(y) * this.bondScale() : 0; };
  // 批次模式下债券只是「批次间周转」：额度与上限一起收紧，免得利息超过补贴能负担的水平
  Economy.prototype.bondScale = function () { return this.batchOn() ? ((this.batchCfg().bondFactor) || 1) : 1; };
  Economy.prototype.issuedIn = function (kind, y) { const a = this.bondIssued[y]; return a ? (a[kind] || 0) : 0; };
  Economy.prototype.outstanding = function (kind) { let s = 0; for (const b of this.bonds) if (!b.done && (!kind || b.kind === kind)) s += b.amount; return s; };
  // 已到期但尚未偿还的本金仍占用债务上限，不能通过逾期腾出发行空间。
  Economy.prototype.principalDebt = function (kind) { let s = this.outstanding(kind); for (const b of this.bonds) if (b.done && (!kind || b.kind === kind)) s += b.principalArrears || 0; return s; };
  Economy.prototype.bondSettled = function (b) { return !!b.done && (b.interestArrears || 0) <= MONEY_EPS && (b.principalArrears || 0) <= MONEY_EPS; };
  Economy.prototype.debtTotal = function () { return this.outstanding() + this.overdue; };
  // 融资限制：有逾期时暂停城投债；逾期满 6 个月暂停全部发行
  Economy.prototype.bondBlock = function (kind) {
    if (!this.canBorrow()) return '只有经营挑战可以发行债券';
    if (this.failed) return '经营挑战已失败';
    if (this.overdueMonths >= 6) return '逾期已满 ' + this.overdueMonths + ' 个月，暂停全部债券发行（还清逾期后恢复）';
    if (kind === 'ct' && this.overdue > MONEY_EPS) return '存在逾期债务，城投债暂停发行（还清逾期后恢复）';
    return null;
  };
  Economy.prototype.bondRoom = function (kind, y) {
    return Math.max(0, Math.min(this.bondQuota(kind, y) - this.issuedIn(kind, y), this.bondCap(kind, y) - this.principalDebt(kind)));
  };
  Economy.prototype.issueBond = function (kind, term, amount, when) {
    if (!BOND_DEF[kind]) return { ok: false, error: '债券类型无效' };
    const y = when.y, block = this.bondBlock(kind);
    if (block) return { ok: false, error: block };
    if (term !== 3 && term !== 6) return { ok: false, error: '期限只能是 3 年或 6 年' };
    amount = Math.round(amount);
    if (!(amount > 0)) return { ok: false, error: '发行金额必须大于 0' };
    const room = this.bondRoom(kind, y);
    if (amount > room + MONEY_EPS) return { ok: false, error: '超出本年度可发行额度（剩余 ' + U.fmtMoney(room) + '）' };
    const q = this.bondQuote(kind, y, term), rate = q.rate;
    // 合同利率在发行时固定，并记录当时的报价构成（之后的市场与财政变化不影响已发行债券）
    const b = { id: 'B' + (this.bondSeq++), kind: kind, amount: amount, rate: rate, term: term, issued: [when.y, when.m, when.d || 1], ym0: U.ymIndex(when.y, when.m), paidYears: 0, interestPaid: 0, interestArrears: 0, principalArrears: 0, done: false,
      quote: q.parts.map(function (p) { return [p.label, Math.round(p.v * 1e6) / 1e6]; }) };
    this.bonds.push(b);
    (this.bondIssued[y] || (this.bondIssued[y] = { local: 0, ct: 0 }))[kind] += amount;
    this.capex += amount;
    this.cur.bond = (this.cur.bond || 0) + amount;
    this.log('bond', amount, 'capex', BOND_DEF[kind].name + ' ' + term + ' 年期 · 年利率 ' + (rate * 100).toFixed(2) + '%', when);
    return { ok: true, bond: b };
  };
  // 从一般资金付款：只用正的余额；不足部分记为逾期
  Economy.prototype.payFromFunds = function (kind, amount, note, when, bond) {
    if (amount <= 0) return 0;
    const paid = Math.min(Math.max(0, this.funds), amount);
    if (paid > 0) { this.funds -= paid; this.cur[kind] = (this.cur[kind] || 0) + paid; this.log(kind, -paid, 'gen', note, when); }
    const short = amount - paid;
    if (bond && kind === 'interest') bond.interestPaid = (bond.interestPaid || 0) + paid;
    if (short > MONEY_EPS) {
      const P = this.odParts(); this.overdue += short; P[kind] = (P[kind] || 0) + short;
      if (bond) bond[kind + 'Arrears'] = (bond[kind + 'Arrears'] || 0) + short;
      this.log('overdue', -short, 'gen', note + '：资金不足，转为逾期', when);
    }
    return paid;
  };
  // 每月（拨款发放后）：先偿还旧逾期，再支付到期的利息与本金，最后按逾期月数收取逾期费用。
  // paidYears 记录已结算的付息期数（含转逾期）；实际付款单独记录，跨周年补齐遗漏的期次。
  Economy.prototype.serviceDebt = function (y, m) {
    if (this.isFree() || !this.bonds) return;
    const ym = U.ymIndex(y, m), when = { y: y, m: m, d: 1 };
    if (this._svc === ym) return;
    this._svc = ym;
    // 偿还旧逾期：按费用、利息、本金的顺序，分别记入对应科目
    if (this.overdue > MONEY_EPS && this.funds > 0) {
      const P = this.odParts();
      for (const k of ['penalty', 'interest', 'principal']) {
        const pay = Math.min(Math.max(0, this.funds), P[k] || 0); if (pay <= 0) continue;
        this.funds -= pay; P[k] -= pay; this.overdue -= pay; this.cur[k] = (this.cur[k] || 0) + pay;
        // 逾期还款也要回写到债券，不能一直显示为未付，或把从未支付的利息显示为已付。
        if (k === 'interest' || k === 'principal') {
          let left = pay;
          for (const b of this.bonds) {
            const key = k + 'Arrears', take = Math.min(left, b[key] || 0);
            if (take <= 0) continue;
            b[key] = Math.max(0, b[key] - take); left -= take;
            if (k === 'interest') b.interestPaid = (b.interestPaid || 0) + take;
            if (this.bondSettled(b)) b.repaid = [y, m];
            if (left <= MONEY_EPS) break;
          }
        }
        this.log('repay', -pay, 'gen', '偿还逾期' + { penalty: '费用', interest: '利息', principal: '本金' }[k], when);
      }
      if (this.overdue <= MONEY_EPS) { this.overdue = 0; this.overdueParts = { interest: 0, principal: 0, penalty: 0 }; }
    }
    for (const b of this.bonds) {
      const dueYears = Math.min(b.term, Math.floor((ym - b.ym0) / 12));
      if (b.done || dueYears <= b.paidYears) continue;
      const name = BOND_DEF[b.kind].name + ' ' + b.id + '（' + b.issued[0] + '年' + b.issued[1] + '月发行）';
      const it = b.amount * b.rate;
      for (let k = b.paidYears + 1; k <= dueYears; k++) {
        b.paidYears = k;
        this.payFromFunds('interest', it, name + ' 第 ' + k + ' 年利息', when, b);
      }
      if (dueYears >= b.term) {
        b.done = true;
        this.payFromFunds('principal', b.amount, name + ' 到期还本', when, b);
        if (this.bondSettled(b)) b.repaid = [y, m];
      }
    }
    if (this.overdue > MONEY_EPS) {
      this.overdueMonths++;
      const rate = this.overdueMonths >= 12 ? 0.02 : (this.overdueMonths >= 6 ? 0.015 : 0.01);
      this.payFromFunds('penalty', this.overdue * rate, '逾期费用（月 ' + (rate * 100).toFixed(1) + '%，已逾期 ' + this.overdueMonths + ' 个月）', when);
    } else { this.overdue = 0; this.overdueMonths = 0; this.overdueParts = { interest: 0, principal: 0, penalty: 0 }; }
  };
  // 未来偿债预测：按年汇总已发行债券的利息与到期本金（不含尚未发生的逾期费用）
  Economy.prototype.odParts = function () {
    if (!this.overdueParts) {
      let interest = 0, principal = 0;
      for (const b of this.bonds) { interest += b.interestArrears || 0; principal += b.principalArrears || 0; }
      this.overdueParts = { interest: interest, principal: principal, penalty: Math.max(0, (this.overdue || 0) - interest - principal) };
    }
    return this.overdueParts;
  };
  Economy.prototype.debtForecast = function (y, m, years) {
    const ym = U.ymIndex(y, m), rows = [];
    for (let k = 0; k < years; k++) rows.push({ y: y + k, interest: 0, principal: 0 });
    for (const b of this.bonds) {
      if (b.done) continue;
      for (let k = b.paidYears + 1; k <= b.term; k++) {
        const t = b.ym0 + 12 * k; if (t < ym) continue;
        const r = rows[Math.floor(t / 12) - y]; if (!r) continue;
        r.interest += b.amount * b.rate;
        if (k === b.term) r.principal += b.amount;
      }
    }
    return rows;
  };

  Economy.prototype.serialize = function () {
    return { mode: this.mode, funds: this.funds, fare: this.fare, cur: this.cur, ledger: this.ledger, sat: this.sat, mods: this.mods, negMonths: this.negMonths, lowSatMonths: this.lowSatMonths, failed: this.failed, satFactors: this.satFactors, lastDay: this.lastDay,
      capex: this.capex, bonds: this.bonds, bondIssued: this.bondIssued, overdue: this.overdue, overdueParts: this.overdueParts || null, overdueMonths: this.overdueMonths, flow: this.flow, bondSeq: this.bondSeq, svc: this._svc == null ? null : this._svc,
      fisc: this.fisc || null, subsidy: this.batchOn() ? (this.subsidyLevel || 'standard') : undefined };
  };
  Economy.restore = function (s, caps) {
    const e = new Economy(s.mode, s.cur.y, s.cur.m, caps);
    Object.assign(e, { funds: s.funds, fare: Economy.normFare(s.fare), cur: s.cur, ledger: s.ledger || [], sat: s.sat, mods: s.mods || [], negMonths: s.negMonths || 0, lowSatMonths: s.lowSatMonths || 0, failed: s.failed || null, satFactors: s.satFactors || null, lastDay: s.lastDay || null,
      capex: s.capex || 0, bonds: s.bonds || [], bondIssued: s.bondIssued || {}, overdue: s.overdue || 0, overdueParts: s.overdueParts || null, overdueMonths: s.overdueMonths || 0, flow: s.flow || [], bondSeq: s.bondSeq || 1, subsidyLevel: s.subsidy || 'standard' });
    e._svc = s.svc == null ? null : s.svc;
    e.fisc = s.fisc && isFinite(s.fisc.f) ? { y: s.fisc.y, f: s.fisc.f } : null;   // 1.7 及更早的存档没有财力系数，按 1 处理
    // 1.6 及更早的正式存档没有债券，默认债务为零。早期 1.7 开发档可能只保存逾期总账，
    // 没有每券构成：从较晚发行的债券开始分摊剩余逾期，保留总额、已用额度与现金余额。
    const P = e.odParts();
    for (const kind of ['interest', 'principal']) {
      const key = kind + 'Arrears';
      let remaining = Math.max(0, (P[kind] || 0) - e.bonds.reduce(function (sum, b) { return sum + (b[key] || 0); }, 0));
      for (let i = e.bonds.length - 1; i >= 0; i--) {
        const b = e.bonds[i];
        if (b[key] != null) continue;
        const due = kind === 'interest' ? b.amount * b.rate * Math.min(b.term, b.paidYears || 0) : (b.done ? b.amount : 0);
        b[key] = Math.min(remaining, due); remaining -= b[key];
        if (kind === 'interest') b.interestPaid = Math.max(0, Math.min(due, b.interestPaid == null ? due : b.interestPaid) - b[key]);
      }
    }
    for (const b of e.bonds) {
      if (!e.bondSettled(b)) delete b.repaid;
      const seq = /^B(\d+)$/.exec(b.id);
      if (seq) e.bondSeq = Math.max(e.bondSeq, Number(seq[1]) + 1);
    }
    // 旧存档的账本没有新科目：补零，保证收支汇总不出现 NaN
    for (const r of e.ledger.concat([e.cur])) for (const k of ['bond', 'interest', 'principal', 'penalty', 'capexUse']) if (r[k] == null) r[k] = 0;
    return e;
  };
  // 票制统一为全网单一票价；旧存档的里程计价按起步价换算
  Economy.normFare = function (f) {
    const R = CFG.fareRange;
    let v = f ? (f.mode === 'flat' ? f.flat : f.base) : CFG.fareDefault.flat;
    if (!isFinite(v)) v = CFG.fareDefault.flat;
    return { mode: 'flat', flat: U.clamp(Math.round(v / R.step) * R.step, R.min, R.max) };
  };
  // 票价对满意度的影响（与月度满意度计算同一公式）
  Economy.fareSatEffect = function (fare, year) {
    const vot = U.interp(CFG.choice.vot, year);
    const burden = fare / (vot * 0.35);
    return -9 * U.clamp((burden - 1) / 2, 0, 1);
  };

  // ======================== 任务 ========================
  function Tasks() {
    this.active = []; this.done = []; this.failed = [];
    this.issued = {};
    this.nextDyn = 0; this.seq = 1;
  }
  CM.Tasks = Tasks;

  // 网络连通分量（线路 + 站外换乘）
  function stationComponents(C, acc) {
    const N = C.stations.length, par = new Int32Array(N);
    for (let i = 0; i < N; i++) par[i] = i;
    const find = function (x) { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
    const uni = function (a, b) { a = find(a); b = find(b); if (a !== b) par[a] = b; };
    for (const r of C.routes) for (let k = 1; k < r.stIdx.length; k++) uni(r.stIdx[0], r.stIdx[k]);
    if (acc) for (const t of acc.transfers) uni(t.a, t.b);
    return { find: find, serviced: C.serviced };
  }
  Tasks.stationComponents = stationComponents;

  // 统计口径（v1.9）：通勤、上学与高峰类目标用工作日数据，旅游与商业休闲类可用周末数据，长期客流目标用周平均
  Tasks.BASIS = { wd: '工作日', we: '周末', avg: '周平均（5 个工作日 + 2 个周末日）', wdAM: '工作日早高峰', wdPeak: '工作日高峰小时', ledger: '上月实际账目', net: '线路连通', cover: '步行 15 分钟覆盖' };
  // 统计口径：默认值由任务类型注册表给出；ridership / facShare 允许任务自带 basis
  Tasks.basisOf = function (t) {
    const H = TYPES[t.type];
    if (!H) return null;
    return typeof H.basis === 'function' ? H.basis(t) : H.basis;
  };
  // 重要设施任务的口径：枢纽按周平均，上学、就医、商务与会展按工作日，商圈、景点、公园与体育场馆按周末
  Tasks.facBasis = function (f) {
    if (f.T.hub) return 'avg';
    if (f.t === 'uni' || f.t === 'hosp' || f.t === 'cbd' || f.t === 'venue') return 'wd';
    return 'we';
  };
  Tasks.facShareOf = function (model, f, basis) {
    const s = model.facStats(f.id, basis); if (!s) return null;
    const vol = f.T.hub ? s.inn + s.out : s.inn, m = f.T.hub ? s.innM + s.outM : s.innM;
    return { vol: vol, share: vol > 0 ? m / vol : 0 };
  };

  // 任务类型注册表：类型、参数与判定集中在一处。编辑器据此列出可选类型与必填参数，
  // 校验器据此检查数据；新增一种任务只需在这里加一项，不必再改 evaluate 的分支链。
  //   name    显示名
  //   basis   默认统计口径（BASIS 的键），可为函数按任务取值
  //   params  必填参数及说明，供表单提示与校验
  //   evaluate(t, ctx) 返回 { ok, value, text }；ctx = { g, C, model, acc }
  const TYPES = {
    // 接驳覆盖：设施周边无法设站（景区、保护区、山体），只能靠车站 + 接驳巴士把它接进网络。
    // 判定不是「地铁到访比例」（景区设施的开车优势让这个比例永远上不去），而是「有没有接驳线到达入口」，
    // 这样任务是可完成、可理解的：玩家需要先找最近的可建地块设站，再开一条接驳线。
    facBus: {
      name: '接驳覆盖', basis: 'net',
      params: [['fac', '设施 id：需要在它的步行圈内开通接驳巴士，且车站已接入线网']],
      evaluate: function (t, ctx) {
        const g = ctx.g, C = ctx.C, fn = ctx.model && ctx.model.fn;
        if (!C || !fn) return { ok: false, value: 0, text: '尚未建成线网' };
        let f = null;
        for (const x of fn.list) if (x.id === t.fac) { f = x; break; }
        if (!f) return { ok: false, value: 0, text: '当前地图没有「' + t.fac + '」' };
        if (!CFG.bus) return { ok: false, value: 0, text: '本模式没有接驳巴士' };
        const R = CFG.bus.walkReachM + 1;
        for (const sid in g.net.stations) {
          const s = g.net.stations[sid];
          if (!s.bus || !s.bus.length) continue;
          const si = C.sIndex.get(sid);
          if (si === undefined || !C.serviced[si]) continue;
          for (const b of s.bus) {
            if (U.dist(b.x, b.y, f.x, f.y) * CFG.CELL_M <= R) return { ok: true, value: 1, text: '「' + s.name + '」的接驳线已到达入口' };
          }
        }
        return { ok: false, value: 0, text: '还没有接驳巴士到达「' + f.name + '」' };
      },
    },
    connect: {
      name: '连通锚点', basis: 'net',
      params: [['anchors', '锚点数组 { name, x, y, r }：每处都要有运营车站，且落在同一个连通分量里']],
      evaluate: function (t, ctx) {
        const C = ctx.C, acc = ctx.acc;
        const comp = stationComponents(C, acc);
        const anchorSets = t.anchors.map(function (a) {
          const set = [];
          C.stations.forEach(function (s, i) { if (C.serviced[i] && U.dist(s.x, s.y, a.x, a.y) <= a.r) set.push(i); });
          return set;
        });
        const hits = anchorSets.map(function (s) { return s.length > 0; });
        let ok = false;
        if (hits.every(Boolean)) {
          const roots = anchorSets.map(function (s) { return new Set(s.map(comp.find)); });
          for (const r of roots[0]) if (roots.every(function (S) { return S.has(r); })) { ok = true; break; }
        }
        const n = hits.filter(Boolean).length;
        return { ok: ok, value: ok ? 1 : n / (t.anchors.length + 1), text: t.anchors.map(function (a, i) { return (hits[i] ? '✓ ' : '✗ ') + a.name; }).join('；') + (hits.every(Boolean) && !ok ? '（车站尚未连通）' : '') };
      },
    },
    coverage: {
      name: '全网覆盖', basis: 'cover',
      params: [['target', '步行 15 分钟覆盖率目标 0–1']],
      evaluate: function (t, ctx) {
        const acc = ctx.acc;
        const v = acc ? acc.coverage : 0;
        return { ok: v >= t.target, value: v / t.target, text: '当前覆盖 ' + U.fmtPct(v) + ' / 目标 ' + U.fmtPct(t.target, 0) };
      },
    },
    zoneCong: {
      name: '片区拥堵', basis: 'wdAM',
      params: [['zone', '交通小区序号'], ['target', '工作日早高峰拥堵指数上限'], ['start', '起始拥堵指数（用于计算进度）']],
      evaluate: function (t, ctx) {
        const v = ctx.g.zoneCong(t.zone, 'wd');
        return { ok: v <= t.target, value: U.clamp((t.start - v) / Math.max(0.01, t.start - t.target), 0, 1), text: '工作日早高峰拥堵指数 ' + v.toFixed(2) + ' / 目标 ≤ ' + t.target.toFixed(2) };
      },
    },
    zoneCov: {
      name: '片区覆盖', basis: 'cover',
      params: [['zone', '交通小区序号'], ['target', '该片区覆盖率目标 0–1']],
      evaluate: function (t, ctx) {
        const acc = ctx.acc;
        const v = acc ? acc.zCov[t.zone] : 0;
        return { ok: v >= t.target, value: v / t.target, text: '该片区覆盖 ' + U.fmtPct(v) + ' / 目标 ' + U.fmtPct(t.target, 0) };
      },
    },
    stationCrowd: {
      name: '车站拥挤', basis: 'wdPeak',
      params: [['station', '车站 id'], ['target', '工作日高峰负荷上限 0–1'], ['start', '起始负荷（用于计算进度）']],
      evaluate: function (t, ctx) {
        const C = ctx.C, model = ctx.model;
        const i = C.sIndex.get(t.station);
        if (i === undefined) return { ok: false, value: 0, text: '车站已拆除' };
        const sd = model.stDailyWk || model.stDaily;
        const peak = sd && !model.dailyStale ? sd.peak[i] || 0 : 0;
        const cap = CFG.metro.stationCap[C.stations[i].size];
        const v = peak / cap;
        return { ok: v <= t.target, value: U.clamp((t.start - v) / Math.max(0.01, t.start - t.target), 0, 1), text: '工作日高峰负荷 ' + U.fmtPct(v, 0) + ' / 目标 ≤ ' + U.fmtPct(t.target, 0) };
      },
    },
    ridership: {
      name: '客运量', basis: function (t) { return t.basis || 'avg'; },
      params: [['target', '日客运量目标（人次）'], ['basis', '统计口径：wd 工作日 / we 周末 / avg 周平均', true]],
      evaluate: function (t, ctx) {
        const model = ctx.model;
        const b = Tasks.basisOf(t), d = model.dailyFor ? model.dailyFor(b) : model.daily;
        const v = d ? d.metro : 0;
        return { ok: v >= t.target, value: v / t.target, text: (b === 'wd' ? '工作日' : (b === 'we' ? '周末' : '日均（周平均）')) + '客运量 ' + U.fmtPeople(v) + ' / 目标 ' + U.fmtPeople(t.target) };
      },
    },
    facShare: {
      name: '设施分担率', basis: function (t) { return t.basis || 'avg'; },
      params: [['fac', '设施 id'], ['target', '乘地铁比例目标 0–1'], ['basis', '统计口径：wd 工作日 / we 周末 / avg 周平均', true]],
      evaluate: function (t, ctx) {
        const model = ctx.model;
        const f = CM.Fac && CM.Fac.byId(t.fac);
        if (!f || model.facIndex(t.fac) < 0) return { ok: false, value: 0, text: '设施目前不在运营' };
        const r = Tasks.facShareOf(model, f, t.basis);
        if (!r) return { ok: false, value: 0, text: '客流计算中' };
        return { ok: r.share >= t.target, value: U.clamp(r.share / t.target, 0, 1), text: (t.basis === 'we' ? '周末' : (t.basis === 'wd' ? '工作日' : '周平均')) + '乘地铁' + (f.T.hub ? '接驳' : '到访') + '比例 ' + U.fmtPct(r.share, 0) + ' / 目标 ' + U.fmtPct(t.target, 0) };
      },
    },
    recovery: {
      name: '运营收支', basis: 'ledger',
      params: [['target', '（票款 + 物业租金）/ 运营费用 目标'], ['sustain', '需连续达标的月数', true]],
      evaluate: function (t, ctx) {
        const g = ctx.g;
        const last = g.econ.ledger[g.econ.ledger.length - 1];
        // 口径是「营业收入」而不是「票款」：上盖物业的租金是运营收入的一部分，
        // TOD 做到位就该算数，否则靠商业开发打平的任务永远判不过。补贴不计入——那等于白送。
        const bus = last ? (last.fare || 0) + (last.property || 0) : 0;
        const v = last && last.ops > 0 ? bus / last.ops : 0;
        return { ok: v >= t.target, value: v / t.target, text: '上月（票款 + 物业）/运营费用 ' + U.fmtPct(v, 0) + ' / 目标 ' + U.fmtPct(t.target, 0) + (t.sustain ? '（需连续 ' + t.sustain + ' 个月，已 ' + (t.streak || 0) + ' 个月）' : '') };
      },
    },
  };
  Tasks.TYPES = TYPES;
  // 供编辑器与校验器读取的类型清单（不含函数）
  Tasks.typeList = function () {
    return Object.keys(TYPES).map(function (k) {
      return { type: k, name: TYPES[k].name, basis: typeof TYPES[k].basis === 'function' ? null : TYPES[k].basis, params: TYPES[k].params };
    });
  };

  Tasks.prototype.evaluate = function (t, g) {
    const H = TYPES[t.type];
    if (!H) return { ok: false, value: 0, text: '' };
    const model = g.model;
    return H.evaluate(t, { g: g, C: g.compiled, model: model, acc: model.net ? model.net.acc : null });
  };

  Tasks.prototype.monthly = function (g) {
    const y = g.clock.y, m = g.clock.m, ym = U.ymIndex(y, m);
    const out = [];
    const caps = g.econ.caps;   // 任务奖励与后果由模式能力决定，不再比较模式名
    // 发布历史参考任务
    for (const h of D.histTasks) {
      if (this.issued[h.id]) continue;
      if (ym < U.ymIndex(h.appear[0], h.appear[1])) continue;
      this.issued[h.id] = 1;
      if (ym > U.ymIndex(h.deadline[0], h.deadline[1])) continue;
      const t = Object.assign({ kind: 'hist', status: 'active', issuedAt: [y, m], streak: 0 }, JSON.parse(JSON.stringify(h)));
      t.reward = h.reward * g.econ.costIndex(y);
      this.active.push(t);
      out.push({ type: 'issued', task: t });
    }
    // 动态任务（开局一年后开始）
    // 运营期任务就是主要资金来源，节奏要跟上：3–5 个月一次（按种子与月份散列，保持可复现），
    // 同时在途最多 3 个，避免「半年一件、一年两件」把玩家卡在没钱的状态里。
    if (!this.nextDyn) this.nextDyn = ym + 12;
    if (!D.noDynTasks && ym >= this.nextDyn && this.active.filter(function (t) { return t.kind === 'dyn'; }).length < 3 && g.compiled.stations.length >= 0) {
      const t = this.generate(g);
      if (t) { this.active.push(t); out.push({ type: 'issued', task: t }); }
      const gap = g.econ.batchOn && g.econ.batchOn() ? 3 + Math.floor(U.hash2(ym, 17, g.seed || 0) * 3) : 6;
      this.nextDyn = ym + gap;
    }
    // 评估。交通模型升级过渡期（旧存档升级当月）：未达标时不清零连续月数，到期任务顺延 1 个月，不判失败
    const transit = g.inTransition ? g.inTransition(ym) : false;
    for (const t of this.active.slice()) {
      const ev = this.evaluate(t, g);
      t.progress = ev;
      let complete = false;
      if (ev.ok) {
        t.streak = (t.streak || 0) + 1;
        if (!t.sustain || t.streak >= t.sustain) complete = true;
      } else if (!transit) t.streak = 0;
      if (!complete && transit && ym >= U.ymIndex(t.deadline[0], t.deadline[1])) {
        const nd = ym + 1; t.deadline = [Math.floor(nd / 12), nd % 12 + 1]; t.graced = '交通模型升级过渡：期限顺延 1 个月';
      }
      if (t.kind === 'dyn' && (complete || ym >= U.ymIndex(t.deadline[0], t.deadline[1]))) {
        this.cool = this.cool || {};
        this.cool[t.coolKey || t.type] = ym + (complete ? 24 : 36);
        this.cool['type:' + t.type] = ym + (complete ? 6 : 18);
      }
      if (complete) {
        t.status = 'done'; t.closedAt = [y, m];
        this.active.splice(this.active.indexOf(t), 1); this.done.push(t);
        if (caps.rewards) { g.econ.income('reward', t.reward); g.econ.log('reward', t.reward, 'gen', '任务奖励：' + t.title, { y: y, m: m, d: 1 }); g.econ.mods.push({ kind: 'sat', delta: 4, until: ym + 5, reason: '完成任务「' + t.title + '」' }); }
        out.push({ type: 'done', task: t });
      } else if (ym >= U.ymIndex(t.deadline[0], t.deadline[1])) {
        t.status = 'failed'; t.closedAt = [y, m];
        this.active.splice(this.active.indexOf(t), 1); this.failed.push(t);
        if (caps.rewards) {
          const E = CFG.economy;
          if (g.econ.batchOn && g.econ.batchOn()) {
            // 批次模式下没有「月拨款 ×0.85」可扣，惩罚统一成一条满意度 buff：
            // 反复未完成只延长它，不叠加数值——否则会陷入越罚越深的死亡螺旋。
            // 满意度同时是批次的乘数与补贴的乘数，所以「政府满意 → 下次给更多」这条正反馈成立。
            const cur = g.econ.mods.filter(function (m) { return m.tag === 'task-fail'; })[0];
            if (cur) {
              cur.until = Math.max(cur.until, ym + E.failGrantMonths - 1);
              cur.hits = (cur.hits || 1) + 1;
              cur.reason = '任务连续未完成（' + cur.hits + ' 次）：' + t.title;
            } else {
              g.econ.mods.push({ kind: 'sat', delta: E.failSat, until: ym + E.failGrantMonths - 1, reason: '任务未完成：' + t.title, tag: 'task-fail', hits: 1 });
            }
          } else {
            g.econ.mods.push({ kind: 'grant', factor: E.failGrantFactor, until: ym + E.failGrantMonths - 1, reason: '任务未完成：' + t.title });
            g.econ.mods.push({ kind: 'sat', delta: E.failSat, until: ym + E.failGrantMonths - 1, reason: '任务未完成：' + t.title });
          }
        }
        out.push({ type: 'failed', task: t });
      }
    }
    if (this.done.length > 60) this.done.splice(0, this.done.length - 60);
    if (this.failed.length > 60) this.failed.splice(0, this.failed.length - 60);
    return out;
  };

  Tasks.prototype.generate = function (g) {
    const y = g.clock.y, m = g.clock.m, model = g.model, city = g.city;
    const acc = model.net ? model.net.acc : null;
    const ci = g.econ.costIndex(y) * (CFG.economy.rewardScale || 1);   // 奖励按本城价格水平
    const dl = function (months) { const t = U.ymIndex(y, m) + months; return [Math.floor(t / 12), t % 12 + 1]; };
    const rng = new U.RNG((y * 13 + m * 7 + this.seq * 31) >>> 0);
    const ym = U.ymIndex(y, m);
    const cool = this.cool || (this.cool = {});
    const active = this.active;
    const free = function (key, type) { return !(cool[key] > ym) && !(cool['type:' + type] > ym) && !active.some(function (t) { return (t.coolKey || t.type) === key; }); };
    const cands = [];
    // 拥堵热点（排除近期出过任务的片区）
    let worst = -1, wv = 0;
    const zoneOpen = function (z) { const cs = model.zoneCells[z]; let n = 0; for (const c of cs) if (city.regionOpen[city.region[c]] && !city.regions[city.region[c]].scenic) n++; return n >= cs.length / 2; };
    for (let z = 0; z < model.Z; z++) {
      if (model.zPop[z] + model.zJobs[z] < 3000 || !zoneOpen(z) || !free('cong:' + z, 'zoneCong')) continue;
      const v = g.zoneCong(z);
      if (v > wv) { wv = v; worst = z; }
    }
    if (worst >= 0 && wv > 1.4) {
      cands.push({ type: 'zoneCong', coolKey: 'cong:' + worst, zone: worst, start: wv, target: Math.max(1.15, 1 + (wv - 1) * 0.6), sustain: 3, title: '缓解「' + g.zoneName(worst) + '」交通拥堵', desc: '该片区工作日早高峰道路拥堵严重。通过地铁吸引汽车出行，将片区早高峰拥堵指数降至目标值，并连续保持 3 个月。统计口径：工作日早高峰。', months: 30, reward: 60000 * ci });
    }
    // 覆盖空白
    if (acc) {
      let best = -1, bp = 0;
      for (let z = 0; z < model.Z; z++) {
        const p = model.zPop[z];
        if (p > bp && acc.zCov[z] < 0.2 && zoneOpen(z) && free('cov:' + z, 'zoneCov')) { bp = p; best = z; }
      }
      if (best >= 0 && bp > 12000) {
        cands.push({ type: 'zoneCov', coolKey: 'cov:' + best, zone: best, target: 0.5, title: '为「' + g.zoneName(best) + '」提供地铁服务', desc: '该片区人口约 ' + U.fmtPeople(bp) + '，尚无地铁覆盖。使片区 50% 以上的居民与岗位步行 15 分钟可达车站。', months: 30, reward: 50000 * ci });
      }
    }
    // 车站拥挤
    const sdw = model.stDailyWk || model.stDaily;
    if (sdw && !model.dailyStale && g.compiled.stations.length) {
      let bs = -1, br = 0;
      g.compiled.stations.forEach(function (s, i) {
        if (!free('st:' + s.id, 'stationCrowd')) return;
        const r = sdw.peak[i] / CFG.metro.stationCap[s.size];
        if (r > br) { br = r; bs = i; }
      });
      if (bs >= 0 && br > 1.0) {
        const s = g.compiled.stations[bs];
        cands.push({ type: 'stationCrowd', coolKey: 'st:' + s.id, station: s.id, start: br, target: 0.9, title: '缓解「' + s.name + '」车站拥挤', desc: '工作日高峰时段车站负荷已达 ' + U.fmtPct(br, 0) + '。可升级车站或分流客流，使高峰负荷降至 90% 以下。统计口径：工作日高峰小时。', months: 12, reward: 30000 * ci });
      }
    }
    // 客流增长
    if (model.daily && model.daily.metro > 20000 && free('ridership', 'ridership')) {
      cands.push({ type: 'ridership', basis: 'avg', target: Math.round(model.daily.metro * 1.2 / 1000) * 1000, title: '提升地铁客运量', desc: '在期限内使日均地铁客运量较当前提高 20%（可通过新线、延长线、换乘或调整票价实现）。统计口径：周平均（5 个工作日 + 2 个周末日）。', months: 24, reward: 40000 * ci });
    }
    // 经营：票款覆盖
    if (g.econ.caps.opsTasks && model.daily && model.daily.metro > 50000 && free('recovery', 'recovery')) {
      cands.push({ type: 'recovery', target: 0.7, sustain: 3, title: '改善运营收支', desc: '连续 3 个月营业收入（票款 + 上盖物业租金）不低于运营费用的 70%。补贴不计入——它不算经营成果。', months: 24, reward: 40000 * ci });
    }
    // 设施附近是否有可设站的地块。保护区、景区、山体与水域上都不能设站，
    // 不检查就会发出「地铁服务灵隐寺」这类永远无法完成的任务：景区整片不能设站，
    // 玩家把线路修到最近的合法地块也有 2.5 km，接驳后地铁比例仍到不了目标值。
    const canStationNear = function (f, radiusM) {
      const R = (radiusM || CFG.walk.maxAccessM) / CFG.CELL_M;
      const i0 = Math.max(0, Math.floor(f.x - R)), i1 = Math.min(city.W - 1, Math.floor(f.x + R));
      const j0 = Math.max(0, Math.floor(f.y - R)), j1 = Math.min(city.H - 1, Math.floor(f.y + R));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const dx = i + 0.5 - f.x, dy = j + 0.5 - f.y;
          if (dx * dx + dy * dy > R * R) continue;
          const c = j * city.W + i;
          const rg = city.regions[city.region[c]];
          if (!rg || rg.scenic || !city.regionOpen[city.region[c]]) continue;
          if (city.landFrac[c] < 0.5) continue;
          if (city.protectedId[c] > 0) continue;
          if (city.lu[c] === CM.LU.WATER || city.lu[c] === CM.LU.HILL || city.lu[c] === CM.LU.AIRPORT) continue;
          return true;
        }
      }
      return false;
    };
    // 重要设施的地铁接驳（v1.9）：到访量较大、乘地铁比例很低的设施；口径按设施类型（见 Tasks.facBasis）
    if (model.facDaily && model.fn && model.net && g.compiled.stations.length) {
      // 设施要能「提高地铁到访比例」，前提是线路能修到它附近。两种情况都算：
      //   ① 1,125 m 内可设站 —— 步行接驳即可；
      //   ② 只能靠接驳巴士（5 km 内可设站）—— 这时任务同时考线网规模与接驳，
      //      但线网太小的时候「20%」在算术上不可能（日到访的 20% 会超过全网客流），
      //      所以设一个规模门槛，避免发出必然失败的任务。
      const metroScale = (model.daily && model.daily.metro) || 0;
      const REACH_SCALE = 50000;   // 全网日地铁达到这个量级，"线网 + 接驳"才足以支撑 20%
      let best = null;
      for (const f of model.fn.list) {
        if (!free('fac:' + f.id, 'facShare')) continue;
        const near = canStationNear(f, CFG.walk.maxAccessM);
        if (!near) {
          const byBus = CFG.bus && canStationNear(f, CFG.bus.maxLenM);
          if (!byBus || metroScale < REACH_SCALE) continue;
        }
        const basis = Tasks.facBasis(f), r = Tasks.facShareOf(model, f, basis);
        if (!r || r.vol < 3000 || r.share > 0.12) continue;
        const score = r.vol * (1 - r.share);
        if (!best || score > best.score) best = { f: f, basis: basis, r: r, score: score };
      }
      if (best) {
        const f = best.f, target = Math.round(Math.max(best.r.share + 0.12, 0.2) * 100) / 100, bn = Tasks.BASIS[best.basis];
        const what = f.T.hub ? '接驳出行' : '到访出行';
        cands.push({ type: 'facShare', coolKey: 'fac:' + f.id, fac: f.id, basis: best.basis, start: best.r.share, target: target, title: '地铁服务「' + f.name + '」',
          desc: f.name + '（' + f.T.name + '）每天约有 ' + U.fmtPeople(best.r.vol) + ' 人次' + what + '（' + bn.replace(/（.*）/, '') + '），乘地铁的比例只有 ' + U.fmtPct(best.r.share, 0) + '。在附近设站并接入线网，使乘地铁的比例达到 ' + U.fmtPct(target, 0) + '。统计口径：' + bn + '。',
          months: 30, reward: 45000 * ci });
      }
      // 周边无法步行设站、但接驳够得着的设施：改为「接驳覆盖」任务。
      // 这类设施（景区、保护区）不可能达到「地铁到访比例」目标，任务应该考的是
      // 「能不能想到用接驳巴士把它接进网络」，而不是让玩家去追一个模型上到不了的比例。
      if (CFG.bus) {
        let pick = null;
        for (const f of model.fn.list) {
          if (!free('busfac:' + f.id, 'facBus')) continue;
          if (canStationNear(f, CFG.walk.maxAccessM)) continue;    // 能直接设站的走 facShare
          if (!canStationNear(f, CFG.bus.maxLenM)) continue;       // 连接驳都够不着，不发
          const r = Tasks.facShareOf(model, f, Tasks.facBasis(f));
          if (!r || r.vol < 3000) continue;
          if (!pick || r.vol > pick.vol) pick = { f: f, r: r };     // 人流最大的先发
        }
        if (pick) {
          const f = pick.f, r = pick.r;
          cands.push({ type: 'facBus', coolKey: 'busfac:' + f.id, fac: f.id,
            title: '为「' + f.name + '」开通接驳巴士',
            desc: f.name + '（' + f.T.name + '）周边 ' + Math.round(CFG.walk.maxAccessM) + ' m 内没有可以设站的地块——它在景区或保护区内，整片不能建设。在附近最近的合法地块修建车站，再从车站开通一条接驳巴士到它的入口。每天约有 ' + U.fmtPeople(r.vol) + ' 人次到访。',
            months: 36, reward: 40000 * ci });
        }
      }
    }
    // 本城专属动态任务（D.dynTasks）：在年份窗口内各发布一次，已满足的不发布
    const self = this;
    for (const tp of D.dynTasks || []) {
      if (this.issued['dyn:' + tp.id] || ym < U.ymIndex(tp.from[0], tp.from[1]) || ym > U.ymIndex(tp.to[0], tp.to[1]) || !free('city:' + tp.id, tp.type)) continue;
      const c = Object.assign({ coolKey: 'city:' + tp.id, cityId: tp.id }, JSON.parse(JSON.stringify(tp)), { reward: tp.reward * ci });
      delete c.from; delete c.to; delete c.id;
      if (this.evaluate(c, g).ok) continue;
      cands.push(c, c);   // 权重加倍，让本城任务更常出现
    }
    if (!cands.length) return null;
    const c = cands[Math.floor(rng.next() * cands.length)];
    if (c.cityId) self.issued['dyn:' + c.cityId] = 1;
    const t = Object.assign({ id: 'd' + (this.seq++), kind: 'dyn', status: 'active', issuedAt: [y, m], deadline: dl(c.months), streak: 0 }, c);
    // 建设批次模式下，要修东西的任务必须能等到下一批钱：批次年之外只有运营补贴，
    // 12–30 个月的期限会变成「不可能任务」。这类任务的期限顺延到「下一批 + 7 个月」。
    if (g.econ.batchOn && g.econ.batchOn()) {
      const CONSTR = { connect: 1, coverage: 1, zoneCov: 1, facShare: 1, facBus: 1 };
      if (CONSTR[c.type]) {
        const B = g.econ.batchCfg(), yrs = B.years || 4, y0 = CFG.START.y;
        const cyc = ((y - y0) % yrs + yrs) % yrs;
        const need = U.ymIndex(y - cyc + yrs, 7);
        if (U.ymIndex(t.deadline[0], t.deadline[1]) < need) t.deadline = [Math.floor(need / 12), need % 12 + 1];
      }
    }
    return t;
  };

  Tasks.prototype.serialize = function () { return { active: this.active, done: this.done, failed: this.failed, issued: this.issued, nextDyn: this.nextDyn, seq: this.seq, cool: this.cool || {} }; };
  Tasks.restore = function (s) { const t = new Tasks(); Object.assign(t, s); return t; };
})(window.CM);
