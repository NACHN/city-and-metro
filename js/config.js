'use strict';
// 全局参数。PRD 中标注"待确认"的数值在此给出可调整的默认值（DEFAULT），评审确认后只需修改本文件。
(function (CM) {
  CM.CFG = {
    GAME_VERSION: '2.4.1',
    TRAFFIC_MODEL: 2,      // 交通模型版本：2 = v1.9 起的出行目的、重要设施与工作日/周末模型（旧存档为 1，载入时升级）
    SAVE_FORMAT: 'city-metro-save',
    SAVE_VERSION: 2,
    SAVE_MIN_VERSION: 2,   // 1.1 起地图改为真实地理，旧版存档的城市数据与之不兼容

    // 地图：每格 250 m，120×96 格 ≈ 30 km × 24 km；交通小区 4×4 格（1 km²）
    W: 120, H: 96, CELL_M: 250, ZONE: 4,
    START: { y: 1990, m: 1, d: 1, minute: 6 * 60 },
    // 货币与价格基年（各地图在 maps.js 中替换）：内部金额单位为「万 + 本城货币」，票价为本城货币
    money: { code: 'CNY', unit: '元', wan: '万元', yi: '亿元', sym: '¥' },
    econBase: 1990,

    time: {
      secPerHour: 2.5,          // 1× 速度下，现实秒/游戏小时（一天 60 秒）
      speeds: [1, 3, 8],        // 加速档位
      visualPerSec: 24,         // 1× 下动态对象的"视觉时间"（游戏秒/现实秒），列车车辆按此运动
    },

    // 一天的出行时段（模型分时段计算）
    periods: [
      { key: 'AM', name: '早高峰', hours: [7, 8] },
      { key: 'MD', name: '日间平峰', hours: [6, 9, 10, 11, 12, 13, 14, 15, 16] },
      { key: 'PM', name: '晚高峰', hours: [17, 18] },
      { key: 'EV', name: '夜间', hours: [19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5] },
    ],
    // 小时出行分布（估算，归一化后使用）：工作日 / 周末（画面上车流、客流随时刻的变化）
    hourProfile: [0.3, 0.2, 0.1, 0.1, 0.2, 0.6, 2.5, 8.5, 9.5, 6.0, 5.0, 5.2, 5.0, 4.8, 4.9, 5.0, 5.6, 8.0, 9.0, 6.0, 4.2, 3.2, 2.0, 1.0],
    hourProfileWe: [0.4, 0.3, 0.15, 0.1, 0.15, 0.3, 0.9, 2.6, 4.4, 5.8, 6.6, 6.8, 6.6, 6.4, 6.5, 6.5, 6.4, 6.4, 6.0, 5.2, 4.2, 3.2, 2.2, 1.2],
    // 出行目的（v1.9 起）：hw 通勤、sc 上学、sh 购物与生活服务（含商务）、md 医疗、lz 旅游休闲、hb 交通枢纽接驳。
    // 工作日通勤出行率与非工作出行总量沿用 choice.workerRate / choice.hoRate；非工作出行按 choice.purposeShare 分为上学、购物、医疗、休闲。
    // 以下比例与倍数均为估算（参考城市居民出行调查的一般量级），不是某座城市的统计数据。
    trips: {
      keys: ['hw', 'sc', 'sh', 'md', 'lz', 'hb'],
      name: { hw: '通勤', sc: '上学', sh: '购物', md: '医疗', lz: '旅游休闲', hb: '枢纽接驳' },
      color: { hw: '#3468d6', sc: '#8e5bd6', sh: '#e8642c', md: '#d63a5a', lz: '#1aa266', hb: '#0f8fa8' },
      // 周末出行量相对工作日的倍数（双休日制度下）；周六仍上班、上课的年代按 workWeek 提高通勤与上学（见 sim.js weekendMult）
      weekend: { hw: 0.32, sc: 0.04, sh: 1.55, md: 0.55, lz: 2.1, hb: 1.12 },
      weekWeights: { wd: 5 / 7, we: 2 / 7 },   // 周平均：5 个工作日 + 2 个周末日
      // 各时段占该目的出行的比例 [AM, MD, PM, EV]：o 去程（家→目的地；枢纽为城市→车站/机场），r 返程
      split: {
        wd: {
          hw: { o: [0.70, 0.22, 0.03, 0.05], r: [0.02, 0.18, 0.62, 0.18] },
          sc: { o: [0.80, 0.17, 0.01, 0.02], r: [0.01, 0.45, 0.42, 0.12] },
          sh: { o: [0.05, 0.55, 0.15, 0.25], r: [0.02, 0.45, 0.20, 0.33] },
          md: { o: [0.25, 0.68, 0.04, 0.03], r: [0.04, 0.80, 0.10, 0.06] },
          lz: { o: [0.04, 0.50, 0.14, 0.32], r: [0.01, 0.36, 0.18, 0.45] },
          hb: { o: [0.16, 0.50, 0.12, 0.22], r: [0.12, 0.48, 0.14, 0.26] },
        },
        we: {
          hw: { o: [0.45, 0.38, 0.05, 0.12], r: [0.02, 0.30, 0.45, 0.23] },
          sc: { o: [0.80, 0.17, 0.01, 0.02], r: [0.01, 0.45, 0.42, 0.12] },
          sh: { o: [0.02, 0.68, 0.10, 0.20], r: [0.01, 0.50, 0.17, 0.32] },
          md: { o: [0.15, 0.78, 0.04, 0.03], r: [0.03, 0.82, 0.10, 0.05] },
          lz: { o: [0.03, 0.62, 0.10, 0.25], r: [0.01, 0.40, 0.17, 0.42] },
          hb: { o: [0.16, 0.50, 0.12, 0.22], r: [0.12, 0.48, 0.14, 0.26] },
        },
      },
      // 距离衰减：上学、购物、医疗、休闲相对 distDecayHO，枢纽接驳相对 distDecayHW
      decay: { sc: 0.55, sh: 1, md: 1.2, lz: 1.5, hub: 1.6 },
      // 地铁改善可达性带来的新增出行（只用于购物与休闲）：每节省 1 分钟广义出行时间增加 perMin，单个起讫点上限 cap；
      // 通勤、上学、医疗与枢纽接驳不产生新增出行（机场与铁路旅客量由外部给定）
      induced: { perMin: 0.006, cap: { sh: 0.10, lz: 0.15 } },
    },

    // 工作周制度（按地图替换）：sat 为周六仍需上班的比例，school 为周六仍需上课的比例（0–1）。
    // 中国内地：1994 年 3 月起隔周双休、1995 年 5 月起全面双休（史实）；比例为估算
    workWeek: { sat: [[1990, 1], [1994.1, 1], [1994.2, 0.5], [1995.3, 0.5], [1995.4, 0]], school: [[1990, 1], [1995.3, 1], [1995.4, 0]] },

    walk: {
      mPerMin: 75,              // 步行速度
      maxAccessM: 1125,         // 进出站最大步行距离（15 分钟）DEFAULT
      transferMaxM: 500,        // 站外换乘最大步行距离 DEFAULT
      cellExtraM: 60,           // 街道到建筑的平均附加距离
    },

    // 接驳巴士（经营模式）：玩家在车站开通的短驳线路，用来覆盖步行到不了的盲区——
    // 站间几十米的隔断、景区与保护区内部、被铁路或快速路切断的街区。
    // 它只扩展「这一站的服务范围」，不凭空产生出行：总量仍由人口决定，变化的是去哪坐车。
    // 等效步行距离 = (车程分钟 + 候车分钟) × 步行速度，所以 1 km 接驳约等于走 600 m。
    // 接驳系统：每个车站要先建「接驳站」（候车亭 + 站牌 + 首末站车位），才能开接驳线。
    // 每条线要买车，配车数决定班次 → 班次决定候车 → 候车决定吸引力。
    // 所以「投多少钱」和「接驳有多大用」是同一件事的两面，不需要额外的系数。
    bus: {
      speedKmh: 35,             // 准直达：站少、绕行少，比公交快、比地铁慢
      turnMin: 3,               // 终点调头
      boardMin: 1,              // 从站台步行上车
      walkReachM: 400,          // 端点周围的步行覆盖半径
      maxLenM: 5000,            // 单条接驳线最长
      maxPerStation: 4,         // 每站最多几条
      hubCost: 30,              // 接驳站的一次性投入（万元，1990 年价）
      vehicleCost: 35,          // 车辆单价（万元/辆，1990 年 8 m 公交 30–40 万）
      targetHeadway: 5,         // 规划间隔（分钟）：据此给出建议配车数
      minVehicles: 2,
      maxVehicles: 12,
      // 单车日运力（人次）：8 m 公交约 60 人/车、5 分钟一班、18 小时营业，
      // 折下来约 2,700 人次/日——用来在车站面板里显示「覆盖 / 运力」，不参与模型计算。
      capacityPerVehicle: 2700,
      opsPerVehicleYear: 12,    // 年运营保养（万元/辆/年）：约 200 车公里/日 × 1.5 元
    },

    // 车站配套（经营模式，T6/T8/T9）：除接驳巴士之外的站口设施。
    // 造价归建设支出（upgrade 科目），维护按造价 2%/年——「建早了」因此有真实成本。
    //   出入口（1990–）：每加一级都是一条地下通道 + 楼扶梯，量级 2,000–5,000 万元。
    //     把「进出站最大步行距离」从 1,125 m 抬到 1,350 / 1,500 / 1,650 m。
    //     覆盖面积按半径平方增长（+44% / +78% / +115%），所以这是个贵但有明显效果的东西。
    //   P+R（2005–）：站口停车场，800 m 内的步行接驳按 0.85 折算（开车到站再换乘）。
    //     8 万元/位含地坪、匝道与收费系统；300 / 500 / 800 位。
    stationFacility: {
      exit: {
        openYear: 1900,
        cost: [0, 2000, 3500, 5000],           // 万元（1990 年价），0–3 级的累计造价
        accessM: [1125, 1350, 1500, 1650],     // 对应 0–3 级的进出站最大步行距离
        name: ['无', '1 级', '2 级', '3 级'],
        what: ['', '加建一个出入口', '四个象限都有出入口', '地面出入口成网，连地下过街'],
      },
      pr: {
        openYear: 2005,
        spaces: [0, 300, 500, 800],            // 对应 0–3 级的停车位
        costPerSpace: 8,                       // 万元/位（1990 年价）
        areaPerSpace: 30,                      // ㎡/位（含通道与匝道）：用地按这个面积算
        reachM: 800,                           // 折算范围：站口 800 m 内的步行段
        walkMul: 0.85,                         // 步行等效距离折减（开车到站，省掉最后一段步行）
        name: ['无', '300 位', '500 位', '800 位'],
      },
      maint: 0.02,                             // 年维护费 ÷ 配套造价
      // 场站用地（D7）：P+R 与地面/高架路权都是「交通用地」，按划拨口径只补市价的四成。
      // 它与拆迁是两笔账：拆迁赔的是地上的房子和住户，用地是取得场地本身。
      // 放在这里而不是 CFG.land，是因为它是配套系统的口径，不随地图变化。
      landUse: 0.4,
      // 地面/高架轨道的路权宽度（米）。地下隧道不占地面用地，所以没有这一项。
      // 用地成本 = 每格地价 × 该格内的轨道长度 × 路权宽度 × landUse，
      // 所以「穿过老城」和「沿外围走」在造价上真的不同——这才是 D7 要影响的东西。
      rowWidthM: { surface: 35, elevated: 15 },
    },

    metro: {
      vmax: { underground: 22, surface: 19, elevated: 22 },  // m/s
      accel: 0.9, dwell: 30, turnaround: 150,
      latAccel: 0.8,            // 弯道横向加速度上限 → 弯道限速
      carCap: 240,              // 每节车厢定员
      carsBySize: { S: 4, M: 6, L: 8 }, // 列车编组受沿线最小站台限制
      fMin: [8, 6, 8, 4],       // 各时段最低发车频率（列/小时）DEFAULT
      fMax: 30,                 // 最小间隔 2 分钟
      targetLF: 0.85,
      stationCap: { S: 9000, M: 20000, L: 40000 }, // 车站每小时进出站+换乘能力 DEFAULT
      minSpacingM: 350,         // 最小站距 DEFAULT
      // 线形约束（参考城市轨道交通设计规范的量级，DEFAULT）
      minRadiusM: 250,          // 正线最小曲线半径：低于此值不允许
      warnRadiusM: 400,         // 低于此值需限速通过
      maxTurnAtStationDeg: 60,  // 车站前后线路方向最大偏转（站台为直线段）
      platformHalfM: 70,        // 站台直线段半长
      maxGrade: 0.03,           // 最大坡度（地下/地面/高架转换坡道）
      levelM: { underground: -15, surface: 0, elevated: 12 }, // 轨面高程（米）
      sizeName: { S: '小型', M: '中型', L: '大型' },
      typeName: { underground: '地下', surface: '地面', elevated: '高架' },
      height: { underground: -0.11, surface: 0.0, elevated: 0.075 }, // 视觉高度（格）
    },

    // 建设成本（万元，1990 年价格，按年上涨）DEFAULT
    cost: {
      trackPerKm: { underground: 30000, surface: 6000, elevated: 12000 },
      riverPerKm: { underground: 22000, surface: 16000, elevated: 16000 }, // 越江隧道 / 跨江桥梁 附加
      hillPerKm: 12000,         // 山体隧道附加
      protectedPerKm: 6000,     // 保护建筑下方隧道加固附加
      // 跨越地面铁路（每处）：按本城单价折算的等效长度（km）。地下线下穿需加固与监测，高架线需上跨铁路的大跨度桥
      railCrossKm: { underground: 0.25, elevated: 0.35 },
      station: {
        underground: { S: 15000, M: 25000, L: 40000 },
        elevated: { S: 8000, M: 13000, L: 20000 },
        surface: { S: 5000, M: 8000, L: 12000 },
      },
      upgradeFactor: 1.2,
      demolishPerCell: 30000,   // 拆迁一个完全开发街区的费用（按开发强度折算）
      demolishFactor: {
        track: { underground: 0, surface: 0.7, elevated: 0.18 },
        station: { underground: 0.25, surface: 0.8, elevated: 0.6 },
      },
      freeMoveM: 250,           // 车站移动不超过此距离免费 DEFAULT
      freeLengthM: 300,         // 线形调整导致增长不超过此值免费 DEFAULT
      relocationFactor: 0.5,    // 大范围搬迁按新站造价比例收费
      inflation: 0.035,
    },

    ops: {
      carKmCost: 0.0009,        // 万元/车厢公里（≈9 元）
      stationDaily: { S: 1.5, M: 2.6, L: 4.5 }, // 万元/天
      serviceHours: 18,
      inflation: 0.04,
    },

    // 全网统一票价（元/次，换乘不另收费）；滑块范围与步长 DEFAULT
    fareDefault: { mode: 'flat', flat: 2 },
    fareRange: { min: 0, max: 10, step: 0.5 },

    choice: {
      theta: 0.065,             // Logit 灵敏度（1/分钟）
      walkW: 1.6, waitW: 1.5,
      transferPen: 4, outTransferPen: 6,
      carAccess: 4,             // 停车与取车附加分钟
      // 以下为估算曲线：[年份, 值]
      vot: [[1990, 2.5], [1995, 5], [2000, 9], [2005, 14], [2010, 22], [2015, 32], [2020, 42], [2030, 58], [2050, 80]], // 元/小时
      carCostPerKm: [[1990, 0.40], [2000, 0.60], [2010, 0.85], [2020, 1.0], [2050, 1.2]],
      parking: [[1990, 0.5], [2000, 2], [2010, 6], [2020, 9], [2050, 12]],
      occupancy: [[1990, 3.4], [1995, 2.8], [2000, 2.3], [2005, 1.9], [2010, 1.6], [2020, 1.45], [2050, 1.4]],
      hoRate: [[1990, 0.16], [2000, 0.26], [2010, 0.38], [2020, 0.45], [2050, 0.5]],
      workerRate: [[1990, 0.36], [2000, 0.40], [2010, 0.43], [2050, 0.45]],
      distDecayHW: [[1990, 4.5], [2000, 6], [2010, 8], [2030, 9.5]], // km
      distDecayHO: [[1990, 2.8], [2010, 4], [2030, 5]],
      // 阻抗口径：'distance' = 直线距离（现状）；'time' = 广义时间（分钟，取小汽车与地铁中较优的那个）。
      // 时间口径下衰减尺度仍按 km 配置，内部换算成分钟：T = L / impedanceRefKmh × 60，
      // 所以两种口径的标定一致，切换只改变「距离」的度量方式，不需要重新标定参数。
      // 为什么需要它：直线距离会把「40 km 的快线通勤」判得比「12 km 的堵车」更远，
      // 导致睡城—市中心的通勤 OD 根本不会被生成（见 开发进度 §9.2）。
      impedance: 'distance',
      impedanceRefKmh: 22,      // 把 km 衰减尺度换算成分钟时的参考速度
      impedanceRailKmh: 40,     // 没有站间 skim 时，用线路平均速度估地铁行程
      impedanceWaitMin: 5,      // 候车与换乘的固定罚时
      impedanceMaxMin: 90,      // 超过这个广义时间的目的地不进入需求表（时间口径下的截断）
      // 非工作出行中上学、医疗、休闲所占比例（其余为购物与生活服务）：少子化使上学比例下降，老龄化使就医比例上升（估算）
      purposeShare: {
        sc: [[1990, 0.30], [2000, 0.26], [2010, 0.21], [2020, 0.19], [2050, 0.16]],
        md: [[1990, 0.06], [2010, 0.07], [2030, 0.09], [2050, 0.10]],
        lz: [[1990, 0.24], [2010, 0.33], [2030, 0.36], [2050, 0.37]],
      },
    },

    road: {
      // 等级：1 支路 2 次干道 3 主干道 4 快速路
      cap: [0, 0, 1700, 3200, 5600],  // 单向小时通行能力（车/小时）
      speed: [0, 15, 28, 38, 65],     // 自由流速度 km/h
      bprA: 0.15, bprB: 4,
      msa: 0.4,
      // 系统道路改造（拓宽、信号优化、立交）带来的通行能力增长系数（估算）
      capGrowth: [[1990, 1.0], [1995, 1.25], [2000, 1.6], [2005, 2.0], [2010, 2.4], [2020, 2.9], [2040, 3.3]],
    },

    economy: {
      startFunds: 300000,       // 经营挑战初始资金 30 亿元 DEFAULT
      grantBase: [[1990, 15000], [2000, 32000], [2010, 70000], [2020, 110000], [2050, 180000]], // 万元/月
      debtLimit: -200000,       // 负债下限（随通胀调整）DEFAULT
      // 债券融资（仅经营挑战）：3 年期年利率按发行年份插值并在发行时固定，6 年期另加 term6；
      // 年度发行额度与总债务上限 = 当年基础月拨款 × 月数（随城市与年代变化）。城投债利率 = 地方债 + spread
      bonds: {
        local: { rate: [[1990, 0.085], [1996, 0.075], [2000, 0.045], [2008, 0.04], [2015, 0.035], [2020, 0.032], [2050, 0.03]], quotaMonths: 6, capMonths: 30 },
        ct: { spread: 0.02, quotaMonths: 4, capMonths: 18 },
        term6: 0.004,
      },
      negMonthsLimit: 24,       // 连续负余额月数上限 DEFAULT
      satFail: 25, satFailMonths: 12,
      startSat: 60,
      failGrantFactor: 0.85, failGrantMonths: 12, failSat: -6,
    },

    growth: {
      popCurve: [[1990, 3.0e6], [1995, 3.45e6], [2000, 4.25e6], [2005, 5.15e6], [2010, 6.2e6], [2015, 6.9e6], [2020, 7.7e6], [2030, 8.5e6], [2045, 9.2e6], [2070, 9.8e6], [2300, 10.2e6]],
      histEnd: 2020,            // 此后为模拟增长
      jobsRatio: [[1990, 0.50], [2000, 0.53], [2010, 0.56], [2030, 0.58]],
      metroBoostMax: 0.06,
    },

    // 建设批次（D1，仅经营模式）：建设资金不再按月发，改成每 4 年一个「盘子」。
    // 盘子 = 4 年 × 上一年地方财政收入 × 配比 k。k 随城市成熟递减（1990 40% → 2030 2%），
    // 所以后期的盘子跟着财政涨——现实里就是五年计划与专项债批次，一批能修几十公里。
    // 与按月发放相比总量相当，但节奏从「挤牙膏」变成「一批开工若干个工地」。
    batch: {
      years: 4,                 // 每 4 年一批（对齐一届政府任期与一条线的合理工期）
      k: [[1990, 0.40], [2000, 0.17], [2010, 0.06], [2020, 0.035], [2030, 0.021], [2050, 0.015]],
      factor: 1.1,              // 建设批次可以配专项债，盘子略大于纯财政配额
      buildFactor: 1.0,         // 批次 = 盘子 × 年数 × 该系数（与补贴无关，只看城市财政）
      // 运营补贴：不是定额，而是「运营成本 × 补贴率 × 满意度系数」。
      // 客均成本高的时候（1990 年 14 元/客）政府补得多，成熟后（2010 年 6 元/客）自然回落，
      // 所以补贴曲线是城市成熟度自己长出来的，不需要另设时间表。
      // 难度 = 补贴率：政府承担多少运营成本，剩下的必须靠票款与物业。
      subsidyRate: { easy: 0.70, standard: 0.50, realistic: 0.35 },
      subsidyName: { easy: '轻松', standard: '标准', realistic: '现实' },
      // 批次制下债券退回「批次间周转」：额度与上限按此系数收紧，免得利息超过补贴能负担的水平
      bondFactor: 0.35,
      subsidySwitchMonths: 12,  // 开局 12 个月内可改补贴率，之后锁定（难度是选择，不是后门）
    },

    // 物业（经营模式）：车站上盖开发。租金按"售价 × 租售比"折算，不做现金流折现。
    // 售价 ≈ 楼面地价（商住地价 ÷ 开发容积率）+ 建安；因此地价涨，租金跟着涨。
    property: {
      areaBySize: { S: 20000, M: 40000, L: 80000 },   // 站台规模决定「最多能盖多少」
      // 商业形态与站台规模正交：任何站都能选其中一种，站台规模只决定上限。
      // 三档的差别不只是面积，而是「服务谁」「能吸多远」「建造成本」全都不同。
      levels: [0, 0.12, 0.4, 1.0],                    // 占面积上限的比例
      levelName: ['未开发', '站内商业', '附建商铺', '商业综合体'],
      levelDesc: ['', '站厅层铺位，只做进出站乘客的顺路生意', '沿街两层商铺，服务周边步行圈', '商场＋塔楼，能吸引跨区客流'],
      levelRes: [0, 0, 0.3, 0.6],                     // 住宅占比：站内商业没有住宅，综合体以住宅为主
      levelL: [0, 0.5, 1.2, 3.0],                     // 吸引半径（相对 distDecayHO）：站内→步行圈→全市
      levelR: [0, 0.3, 0.6, 1.05],                    // POI 半径（格）：抬升地价的范围
      // POI 强度：不只是范围，中心强度也要随形态上升。一个综合体对周边地价的拉动
      // 远大于几个站内铺位，这是「大的贵但带得动地价」的来源。
      levelPoi: [0, 0.18, 0.5, 1.3],
      levelWeekend: [0, 1.0, 1.15, 1.5],              // 周末吸引倍数
      levelTicket: [0, 0.5, 0.8, 1.2],                // 客单价系数：便利店式小额 vs 综合体客单价
      levelPassBy: 0.08,                              // 站内商业的顺路转化率（占日进站量的比例）
      // 建安（元/㎡，1990 年价，随 cost 指数上涨）。三档的建造性质完全不同，不能套一个数：
      // 站内商业：站厅层装修与铺位分隔，无结构工程
      // 附建商铺：两层框架（宁波 1990 造价指标 5-6 层 460 元/㎡，加商业装修与机电翻倍）
      // 商业综合体：商业裙楼＋塔楼，20 层以上高层指标 1,500 元/㎡，含平台转换与商场机电，取 3,000
      levelCost: [0, 1500, 1600, 3000],
      far: 4,                                         // 上盖开发容积率（楼面地价 = 地价 ÷ 该值）
      buildCost: 800,                                 // 兼容旧调用；新代码按 levelCost 取
      rentYield: 0.08,                                // 年租售比
      // 商业溢价：核心区上盖能拿来做商业，租金高于住宅。按地价相对全城中位放大，
      // 地价到中位的 (1+span) 倍时吃满 premiumGain。所以"选址"直接影响租金，而不是统一加成。
      // 上盖是混合开发：住宅部分带来居住人口（这是唯一能真正增加出行的方式——模型的总出行由居住人口决定），
      // 商业部分带来岗位与购物吸引。
      resShare: 0.6,
      resAreaPerCap: 40,                              // 人均住宅建筑面积（㎡），与城市容量口径一致
      jobsPerM2: 1 / 30,                              // 商业岗位密度（30 ㎡ / 岗位）
      premiumGain: 0.5,
      premiumSpan: 3,
      maintain: 0.012,                                // 年维护费 ÷ 建安
      ramp: [0, 0.3, 0.7, 1],                         // 建成后第 0/1/2/3 年的出租率
      // 商业部分按「商场模型」收租：上盖商场作为设施节点进入出行模型（Fac.dynamic），
      // 它提升的是「这一带作为购物与休闲目的地的吸引力」——通勤 OD 完全不动。
      // 出行总量守恒，变化的是去向（去这家而不是别处）与交通方式（商场在地铁站上，坐地铁更划算）。
      // 营业额 = 实际到访人次 × 客单价；租金 = 营业额 × 租金率。
      // 标定：1990 广州社零 124.29 亿元 / 594 万人 ≈ 2,092 元/人/年；2010 年约 3.34 万元/人/年。
      // 租金率：ICSC 健康区间 8–15%，中国零售 8–12%、餐饮 10–15%，取 11%。
      market: {
        // 客单价（元/人次）：由「人均社零 ÷ 年购物出行次数」推出，再乘「专程出行占比」。
        // 1990：人均社零 2,100 元/年、购物出行约 30 次/年、其中专程购物约四成 → 约 28 元。
        // 2010：人均 3.34 万元、约 40 次/年 → 约 150 元。2010 后购物中心业态成熟，客单价继续上行。
        ticketPrice: [[1990, 28], [2000, 70], [2010, 150], [2020, 230], [2050, 400]],
        rentRatio: 0.11,              // 租金 ÷ 营业额
        resYield: 0.025,              // 住宅部分的租售比（商业靠客流，住宅靠售价，两者量纲不同）
        // 每岗位折算的「购物中心形态」零售面积（㎡）：街区商铺、超市、餐饮不构成同面积竞争，
        // 所以不是岗位全面积。1990 年全市购物中心形态零售约 200 万㎡量级。
        m2PerJob: 1.2,
        maxMallShare: 0.3,            // 单家商场份额上限
        // 商业分级：规模决定「吸引多远」与「占地多大」，不是同一套参数乘以面积。
        // L 是距离衰减倍数（相对 distDecayHO）；r 是 POI 影响半径（格），决定它对地价的抬升范围。
        //   S 社区型：只服务步行圈，吸不到跨区客，短期会让周末跨区出行减少，靠抬地价长期回本
        //   M 区域型：本地减少由邻近客流补齐，收支平衡
        //   L 市级型：能吸全市客流，因此也最容易被同城的其它 L 抢走——密集布点会互相抵消
        mallL: [0.9, 1.7, 3.0],
        mallR: [0.5, 0.75, 1.05],
        mallWeekend: [1.05, 1.25, 1.5],   // 周末相对工作日的吸引倍数：越大越偏休闲目的地
      },
    },

    // TOD 增值回收（经营模式）：站点周边的地价年度增量，按比例分成给运营方。
    // 现实中即「轨道 + 物业」的土地增值捕获，也是把地价直接变成现金流的唯一科目。
    // 严格做法是「有站 vs 无站」的反事实对比，太贵；这里按区域地价上涨收，与现实的征收口径一致。
    // 先设 3%：文档 §4.3 推算调到 15% 会让票款变得无关紧要。
    valueCapture: {
      radiusM: 300,             // 计入范围（米）：0.6 格半径，约覆盖 4–5 格
      rate: 0.03,               // 回收率（占年度增量的比例）
      label: 'TOD 增值分成',
    },

    // 地价（仅经营模式）：每月由 POI、站点可达性与岗位密度重算的派生量，不存档、不参与既有模式的任何计算。
    // 这里的是**市场地价**（元/㎡ 土地面积），用于热力图、物业与增值分成。
    // 拆迁补偿另算：clearFactor 倍市价（含房屋补偿、安置与拆除），见 City.clearPerCell。
    // 基准取史实量级：1988 年广州首次招拍挂（芳村花地湾）楼面地价 218 元/㎡、土地约 260 元/㎡；
    // 1990 年广州住宅均价 1,203 元/㎡（地价约占房价 25–40%）。base 是外围基准，核心由梯度乘出来。
    land: {
      // 外围基准地价（本图货币，1990 年价）。按史实「楼面地价 = 房价 × 30–40%」反推：
      // 广州 1990 房价约 1,200 元/㎡、核心楼面地价约 900 元/㎡ → 土地价（容积率 4）约 3,600。
      // 这是**基准**（外围最低值），核心区由 POI / 可达 / 密度三项乘子上浮，实测 p90 楼面 ≈ 900。
      base: 1000,
      clearFactor: 1.4,         // 拆迁补偿 = 市价 × 该系数（补偿高于纯地价，但远低于旧口径）
      // 安全阀：单格拆迁不超过「本地地下线单价 × 该倍数」。征收成本不可能无限高于工程造价，
      // 香港、台北按真实地价×高梯度会冲到隧道的 5–9 倍，必须先封顶。
      clearCapTunnel: 2,
      // 梯度系数：把模型算出的相对乘子按各地真实的核心/外围差拉伸（1 = 不拉伸）。
      // 真实差值：香港中环 vs 新界约 60 倍、台北市 vs 台北县约 10 倍、广州约 6 倍。
      // 模型自带的梯度只有 2–3 倍，所以用 gradK 按图放大，而不是全局加陡（会毁掉广州的观感）。
      gradK: 1,
      maxMul: 30,               // 拉伸后的总乘子上限
      poiGain: 0.9,             // POI 核密度对地价的加成系数
      poiGroup: { '交通枢纽': 1.0, '商业': 0.8, '教育': 0.5, '医疗': 0.5, '旅游休闲': 0.4 },
      poiRadius: 4,             // POI 影响半径 = 设施场地半径 × 该系数（格）
      accessGain: 0.7,          // 站点旁的加成（步行 0 m 处）
      accessScale: 700,         // 步行衰减尺度（米）：700 m 处约剩 37%
      // 密度项：地租随人口与岗位密度上升（地价的本底驱动）。岗位按 1.5 倍计入商业支付意愿。
      // 实测（广州 1990，无地铁）：1.40/0.80 时核心/外围 10.8×，偏陡；0.75/0.60 时为 5.4×，落在设计目标 4–6×。
      densGain: 0.75,
      densRef: 1200,            // 密度参考值（人 + 1.5×岗位，每格）
      densPow: 0.6,             // 亚线性：密度翻倍，地价不到翻倍
      densCap: 4,               // 密度指数上限，避免个别格爆表
      jobGain: 0.2,             // 岗位密度加成（在密度项之外的额外商业溢价）
      jobRef: 8000,             // 岗位密度参考值（岗位/格，约等于一般商业容量）
      // 容积率联动：这是「修地铁 → 站点可达 → 允许加密 → 人口涌入 → 出行增加」闭环的最后一环。
      // 用**站点步行可达性**驱动，而不是「高于全城中位地价」——后者会让新区永远拿不到加成
      // （新区地价本来就低于中位），而 TOD 的增量恰恰来自新区。现实中就是「站点周边放宽容积率」。
      // farK = 1 + farGain × (accMul − 1) / accessGain，accMul ∈ [1, 1+accessGain]，所以 farK ∈ [1, 1+farGain]。
      // 没有地价系统（自由建造 / 经营挑战）时 landAcc 为空，farK 恒为 1。
      farGain: 1.5,             // 站点正上方最多把容量提高到 2.5 倍（FAR 4 → 10，接近真实 TOD）
    },

    saves: { prefix: 'cm1.', maxManual: 12 },
    // 动态对象上限（代表性展示）：汽车、车站行人、街道行人、列车上下车乘客（每帧）；声音：列车声部与同时播放的环境短音
    perf: { solverBudgetMs: 5, chunkBudgetMs: 6, cacheMaxPx: 24e6, maxCars: 320, maxPeds: 180, maxWalkers: 120, maxRiders: 120, trainVoices: 3, maxOneShots: 6 },
  };

  // 地价与容积率的联动（顶层配置，不随地图导出）：
  //   winMin      —— 可达性窗口（分钟）：30 分钟内可达的岗位数，同时用于地价的可达项与容积率的可达项。
  //                  实测窗口越长，可达性场越平（中心 30 分钟已覆盖几乎全部岗位），地铁溢价反而被稀释，
  //                  所以用 30 分钟，而不是 40–60（见 开发进度 §9.12）。
  //   farPriceK   —— 地价惩罚系数：farK = f(可达性) / (1 + k × max(0, 地价/中位 − 1))。
  //                  同样可达性下，地价高的地方拆迁贵、审批难，不该再加容量；k=1 时地价两倍于中位的格子容量乘子减半。
  // 只对经营模式生效：free / challenge 没有地价系统，farK 恒为 1。
  CM.LAND_LINK = { winMin: 30, farPriceK: 1.0 };

  // 增长权重里的「可达项」用哪个量（顶层配置，不随地图导出）：
  //   'walk'      = 步行到站距离三档（现状，free/challenge 用）
  //   'jobAccess' = 45 分钟内可达的岗位数（经营模式用，见 Model.computeJobAccess）
  // 三档阈值按「相对全市均值」给，系数与 walk 口径完全一致（1 / 0.55 / 0.22），所以切换只改「用哪个量」。
  // 放在顶层而不是 CFG.growth 里：growth 在 MAP_CFG_KEYS 中，往里加键会要求每张地图同步刷新 source.json。
  CM.GROWTH_ACCESS = { from: 'walk', minMin: 45, bands: [1.5, 1.0, 0.6] };

  // 模式能力表：所有「钱怎么算、任务有没有后果、有没有土地与车辆系统」的判断都从这里读。
  // 不要再用 mode === 'challenge' 这类字符串比较——新增模式时漏改会静默降级成自由建造。
  // 未登记的模式按 challenge 处理（与加表之前的行为一致）。
  // land / fleet 是 tycoon 专属系统（地价与物业、车型与车辆购置），其余模式一律关闭。
  // needs 决定「这张图能不能开这个模式」，作为能力判断写在这里，不再逐图往数据文件里抄一行清单。
  // 真实城市才有城市经济（macro），所以带预算与拨款的模式只对它们开放；虚构地图（新手教程）只有自由建造。
  // 个别地图要例外时在数据里写 noModes: ['tycoon']，仍然不需要复制整张清单。
  // ====================== 系统开关与难度预设 ======================
  // 难度不再是「模式」标签，而是「开了哪些系统 + 这些系统的参数」。
  //   CM.SYSTEMS  每个系统一个开关（id / 名称 / 说明 / 组 / 依赖 / 是否可关）
  //   CM.PRESETS  预设 = 一部分开关关掉 + 一组数值档
  //   CM.capsFor(preset, overrides)  →  caps（与旧 CM.modeCaps 同结构，26 处调用点不用改）
  // needs：父系统关掉时，依赖它的系统自动关（例如没有地价就没有 TOD 分成）。
  // locked：底层能力，不可关（接驳巴士是「最后一公里」任务的兜底，见灵隐寺这类任务）。
  CM.SYSTEMS = [
    { id: 'budget', group: 'money', name: '有限资金', desc: '关掉＝资金无限（沙盒）。拨款、债券、利息、失败判定都依赖它。' },
    { id: 'batch', group: 'money', name: '建设批次', desc: '建设资金四年一批、运营按成本补贴；关掉则改为按月拨款、按城市财政比例。', needs: ['budget'] },
    { id: 'land', group: 'money', name: '地价与物业', desc: '地价、上盖开发、拆迁成本、容积率联动。关掉后城市不再有土地经济。', needs: ['budget'] },
    { id: 'tod', group: 'money', name: 'TOD 增值分成', desc: '站点周边地价上涨按比例分给运营方。', needs: ['land'] },
    { id: 'bonds', group: 'money', name: '债券融资', desc: '可以发地方债与城投债为建设筹资。', needs: ['budget'] },
    { id: 'failure', group: 'money', name: '经营失败', desc: '资金触底、债务逾期、满意度长期过低会结束游戏。', needs: ['budget'] },
    { id: 'rewards', group: 'money', name: '任务奖励', desc: '完成任务获得拨款与满意度加成；关掉后任务只剩提示。', needs: ['budget'] },
    { id: 'opsTasks', group: 'money', name: '运营任务', desc: '按客流与运营状况自动生成的任务。', needs: ['budget'] },
    { id: 'fareControl', group: 'money', name: '票价管制', desc: '票价由政府定价：三年才能调一次、单次最多 +1 元。', needs: ['budget'] },
    { id: 'timeCommute', group: 'world', name: '通勤时间口径', desc: '出行按广义时间衰减；关掉则按直线距离（长距离快线会被低估）。' },
    { id: 'jobAccess', group: 'world', name: '增长读就业可达', desc: '住宅增长看 45 分钟可达岗位；关掉只看步行到站与临街。' },
    { id: 'bus', group: 'world', name: '接驳巴士', desc: '底层能力，始终开启：给「最后一公里」这类任务兜底。', locked: true },
    { id: 'fleet', group: 'other', name: '车型与车队', desc: '车型选择与车辆购置（开发中）。', impl: false },
  ];
  // 预设：off 里列出的系统关掉，其余按默认开；tuning 是数值档。
  // 补贴率是实测定的：全系统打开时 0.5 已经要很小心地排建设节奏，所以 0.5 归「困难」。
  CM.PRESET_ORDER = ['sandbox', 'easy', 'normal', 'hard', 'real'];
  CM.PRESETS = {
    sandbox: {
      id: 'sandbox', name: '沙盒', badge: 'b-teal', icon: 'sparkle',
      desc: '资金无限，经营压力全关；专注设计与建造。',
      off: ['budget', 'batch', 'land', 'tod', 'bonds', 'failure', 'rewards', 'opsTasks', 'fareControl', 'timeCommute'],
      tuning: { subsidyRate: 0 },
    },
    easy: {
      id: 'easy', name: '简单', badge: 'b-green', icon: 'smile',
      desc: '政府承担全部运营成本，只需操心建设与债务。',
      off: ['batch', 'tod', 'fareControl'],
      tuning: { subsidyRate: 1.0 },
    },
    normal: {
      id: 'normal', name: '一般', badge: 'b-blue', icon: 'flag',
      desc: '建设四年一批、运营补贴 70%，地价与上盖可用。',
      off: ['tod', 'fareControl'],
      tuning: { subsidyRate: 0.7 },
    },
    hard: {
      id: 'hard', name: '困难', badge: 'b-orange', icon: 'bolt',
      desc: '补贴降到 50%，票价可自由调整，靠涨价自救。',
      off: ['fareControl'],
      tuning: { subsidyRate: 0.5 },
    },
    real: {
      id: 'real', name: '真实', badge: 'b-red', icon: 'target',
      desc: '补贴 50% 但票价受管制（三年一次、最多 +1 元），增长也按就业可达。',
      off: [],
      tuning: { subsidyRate: 0.5 },
    },
  };
  // 由预设 + 玩家微调算出 caps。结构必须与旧 CM.MODES 的条目一致（budget/land/… ），
  // 这样 26 处 econ.caps.* 的调用点一个字都不用改。
  CM.capsFor = function (presetId, overrides) {
    const P = CM.PRESETS[presetId] || CM.PRESETS.normal;
    const off = {};
    for (const id of (P.off || [])) off[id] = true;
    const caps = { preset: P.id, tuning: P.tuning || {} };
    const set = function (s) {
      const want = s.locked ? true : !off[s.id];
      caps[s.id] = want && (s.impl === false ? false : true);
    };
    for (const s of CM.SYSTEMS) set(s);
    if (overrides) for (const k in overrides) if (k in caps && typeof overrides[k] === 'boolean') caps[k] = overrides[k];
    // 依赖闭包：父系统关掉，子系统的开关失效（改两次以覆盖链式依赖）
    for (let pass = 0; pass < 2; pass++) {
      for (const s of CM.SYSTEMS) {
        if (!caps[s.id]) continue;
        for (const n of (s.needs || [])) if (!caps[n]) caps[s.id] = false;
      }
    }
    for (const s of CM.SYSTEMS) if (s.locked) caps[s.id] = true;
    caps.grants = !!caps.budget;          // 兼容旧字段
    caps.subsidyRate = (P.tuning && typeof P.tuning.subsidyRate === 'number') ? P.tuning.subsidyRate : null;
    return caps;
  };
  CM.presetName = function (id) { const P = CM.PRESETS[id]; return P ? P.name : '自定义'; };

  CM.MODES = {
    free: { id: 'free', name: '自由建造', budget: false, grants: false, bonds: false, failure: false, rewards: false, opsTasks: false, land: false, fleet: false, batch: false, bus: true, needs: function () { return true; } },
    challenge: { id: 'challenge', name: '经营挑战', budget: true, grants: true, bonds: true, failure: true, rewards: true, opsTasks: true, land: false, fleet: false, batch: false, bus: true, needs: function (m) { return !m.tutorial; } },
    // timeCommute：出行分布按「广义时间」而不是直线距离衰减（见 CFG.choice.impedance）。
    // 只在经营模式打开：挑战模式与自由建造保持原口径，数值与指纹不变。
    // batch 原本隐含在 land 里（batchOn 曾读 caps.land），这里显式写出来——这是 P1 的等价重构关键点
    tycoon: { id: 'tycoon', name: '经营模式', budget: true, grants: true, bonds: true, failure: true, rewards: true, opsTasks: true, land: true, fleet: true, batch: true, bus: true, timeCommute: true, needs: function (m) { return !m.tutorial && !!m.cfg.macro; } },
  };
  CM.modeCaps = function (mode) { return CM.MODES[mode] || CM.MODES.challenge; };
  CM.modeName = function (mode) { return (CM.MODES[mode] || CM.MODES.challenge).name; };
  // 开始界面里模式的先后（与难度无关，只是展示顺序）
  CM.MODE_ORDER = ['challenge', 'tycoon', 'free'];
  // 一张地图支持哪些模式：由能力表算出来。m 需要已经合并好 cfg（maps.js 在合并后调用）。
  CM.modesForMap = function (m) {
    const off = (m && m.noModes) || [];
    return CM.MODE_ORDER.filter(function (id) {
      const s = CM.MODES[id];
      return !!s && off.indexOf(id) < 0 && (!s.needs || s.needs(m));
    });
  };

  // 随地图切换的配置键（maps.js 用它做切图，编辑器与校验器用它判断 cfg 是否合法）
  CM.MAP_CFG_KEYS = ['W', 'H', 'START', 'growth', 'land', 'money', 'econBase', 'cost', 'ops', 'fareDefault', 'fareRange', 'economy', 'macro', 'choice', 'road', 'workWeek'];

  // 共用用地配方（放在配置里，不再由广州数据文件提供）：每份配方是各类用地在同一街区内的占比，合计为 1。
  // city.js 按区域声明中的 plan 名称取用；未声明 plan 的区域取 res。地图可以整表覆盖（data.plans）。
  CM.PLANS = {
    oldmix: { RES: 0.5, MIX: 0.35, COM: 0.1, INST: 0.05 },
    cbd: { COM: 0.7, MIX: 0.2, RES: 0.1 },
    mix: { RES: 0.45, MIX: 0.25, COM: 0.1, INST: 0.12, IND: 0.08 },
    res: { RES: 0.7, MIX: 0.15, COM: 0.05, INST: 0.05, IND: 0.05 },
    resind: { RES: 0.45, IND: 0.35, MIX: 0.1, COM: 0.05, INST: 0.05 },
    port: { IND: 0.45, RES: 0.35, MIX: 0.15, COM: 0.05 },
    ind: { IND: 0.6, RES: 0.25, MIX: 0.1, COM: 0.05 },
    campus: { INST: 0.6, RES: 0.25, MIX: 0.1, COM: 0.05 },
    expo: { COM: 0.45, MIX: 0.25, RES: 0.3 },
    newtown: { RES: 0.45, MIX: 0.3, COM: 0.2, INST: 0.05 },
  };

  // 地标专属造型：数据里可以写哪些 style、它们画在哪些 kind 上。
  // 形状本身仍由 render.js 的绘制代码实现（三维形体无法纯数据化）；这里只登记清单，
  // 供校验器检查数据、供编辑器提供下拉选项。写错的 style 会安静回退到默认造型，因此必须校验。
  // east 是超高层（skyscraper）的默认形状，一般不必显式写。
  CM.LANDMARK_STYLES = {
    east: { name: '方形分段收分', kinds: ['skyscraper'], desc: '分段收分的方塔 + 竖向窗带（超高层默认）' },
    citic: { name: '方塔 + 双桅杆', kinds: ['skyscraper'], desc: '裙楼 + 两座公寓塔 + 双桅杆主塔' },
    west: { name: '圆角三角筒', kinds: ['skyscraper'], desc: '圆角三角形玻璃筒 + 斜交网格' },
    taipei101: { name: '竹节式分段', kinds: ['skyscraper'], desc: '截头方锥基座 + 8 节外倾竹节 + 塔尖' },
    skytree: { name: '变截面桁架塔', kinds: ['lattice'], desc: '三角底座渐变为圆形的白色桁架' },
  };
})(window.CM);
