/*
 * 鎏金象棋 - 主程序（状态机 / 渲染 / 交互 / 动画）
 */
(function () {
  'use strict';

  const R = window.XQRules;
  const TAU = Math.PI * 2;
  const W = 720;
  const H = 800;
  const CELL = 76;
  const X0 = 56;
  const Y0 = 52;
  const PX = (c) => X0 + c * CELL;
  const PY = (r) => Y0 + r * CELL;
  const PIECE_R = 31;

  // 攻击动画时序（吃子一小段：蓄力 -> 突进 -> 命中顿帧）
  const MOVE_DUR = 0.24;     // 普通走子
  const CAP_DUR = 0.5;       // 吃子总时长
  const WIND_Q = 0.16;       // 蓄力段占比
  const DASH_Q = 0.6;        // 命中时刻占比（此瞬爆裂）
  const HIT_STOP = 0.085;    // 命中顿帧（秒）
  const HIT_STOP_K = 0.16;   // 吃将加长顿帧

  const canvas = document.getElementById('board');
  const ctx = canvas.getContext('2d');

  const fx = new window.XQFX.Particles();
  const sound = new window.XQFX.Sound();
  let boardLayer = null;

  // 局世代令牌：newGame/undo 自增，使旧局挂起的定时器回调全部失效
  let epoch = 0;

  const state = {
    mode: 'pvp',          // pvp | pve
    human: 'r',
    level: 2,
    board: R.createBoard(),
    turn: 'r',
    selected: null,
    targets: [],
    history: [],
    anim: null,
    thinking: false,
    over: false,
    winner: null,
    lastMove: null,
    checkedSide: null,
    slowmo: null,
    hitstop: 0,            // 命中顿帧倒计时（实时秒，冻结 anim/fx）
    punch: null,           // 镜头冲击 {x,y,t,dur,mag}
    reps: new Map(),      // 局面键 -> 出现次数（三次重复判和）
  };

  // 局面键（棋子构成 + 轮到谁；不含 history）
  function positionKey(b, side) {
    let s = side;
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const p = b[r][c];
        if (p) s += p.side + p.t + r + ',' + c + ';';
      }
    }
    return s;
  }

  // 从棋谱重建重复计数（undo 后使用）
  function rebuildReps() {
    const reps = new Map();
    let b = R.createBoard();
    reps.set(positionKey(b, 'r'), 1);
    for (let i = 0; i < state.history.length; i++) {
      b = R.applyMove(b, state.history[i].move);
      const side = (i + 1) % 2 === 0 ? 'r' : 'b';
      const k = positionKey(b, side);
      reps.set(k, (reps.get(k) || 0) + 1);
    }
    state.reps = reps;
  }

  // ---------- 画布适配 ----------
  function fitCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ---------- 棋盘静态层（离屏缓存） ----------
  function buildBoardLayer() {
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const g = off.getContext('2d');

    // 背景氛围
    const bg = g.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, 620);
    bg.addColorStop(0, '#241710');
    bg.addColorStop(0.65, '#160e09');
    bg.addColorStop(1, '#0b0705');
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    // 棋盘木板
    const bx = X0 - 32, by = Y0 - 28, bw = CELL * 8 + 64, bh = CELL * 9 + 56;
    const wood = g.createLinearGradient(bx, by, bx + bw, by + bh);
    wood.addColorStop(0, '#815430');
    wood.addColorStop(0.45, '#6b4122');
    wood.addColorStop(1, '#4d2c15');
    roundRect(g, bx, by, bw, bh, 14);
    g.fillStyle = wood;
    g.fill();
    // 木纹
    g.save();
    g.globalAlpha = 0.1;
    g.strokeStyle = '#2a1608';
    g.lineWidth = 1;
    for (let i = 0; i < 26; i++) {
      const yy = by + 12 + i * ((bh - 24) / 25) + Math.sin(i * 2.7) * 4;
      g.beginPath();
      g.moveTo(bx + 10, yy);
      g.bezierCurveTo(bx + bw * 0.3, yy + 6, bx + bw * 0.7, yy - 6, bx + bw - 10, yy + 2);
      g.stroke();
    }
    g.restore();
    // 金边（双线）
    g.lineWidth = 2.4;
    g.strokeStyle = '#d8b567';
    roundRect(g, bx + 4, by + 4, bw - 8, bh - 8, 10);
    g.stroke();
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(255,235,180,.45)';
    roundRect(g, bx + 9, by + 9, bw - 18, bh - 18, 8);
    g.stroke();

    // 网格
    g.strokeStyle = 'rgba(240,218,166,.72)';
    g.lineWidth = 1.3;
    for (let r = 0; r < 10; r++) {
      g.beginPath();
      g.moveTo(PX(0), PY(r));
      g.lineTo(PX(8), PY(r));
      g.stroke();
    }
    for (let c = 0; c < 9; c++) {
      if (c === 0 || c === 8) {
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(PX(c), PY(0));
        g.lineTo(PX(c), PY(9));
        g.stroke();
        g.lineWidth = 1.3;
      } else {
        g.beginPath();
        g.moveTo(PX(c), PY(0));
        g.lineTo(PX(c), PY(4));
        g.moveTo(PX(c), PY(5));
        g.lineTo(PX(c), PY(9));
        g.stroke();
      }
    }
    // 九宫斜线
    g.beginPath();
    g.moveTo(PX(3), PY(0)); g.lineTo(PX(5), PY(2));
    g.moveTo(PX(5), PY(0)); g.lineTo(PX(3), PY(2));
    g.moveTo(PX(3), PY(7)); g.lineTo(PX(5), PY(9));
    g.moveTo(PX(5), PY(7)); g.lineTo(PX(3), PY(9));
    g.stroke();

    // 楚河汉界
    g.fillStyle = 'rgba(244,222,172,.9)';
    g.font = 'italic bold 31px KaiTi, STKaiti, "楷体", serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const riverY = (PY(4) + PY(5)) / 2;
    drawSpaced(g, '楚 河', X0 + CELL * 2, riverY, 10);
    drawSpaced(g, '漢 界', X0 + CELL * 6, riverY, 10);

    // 炮位 / 兵位角标
    const marks = [
      [2, 1], [2, 7], [7, 1], [7, 7],
      [3, 0], [3, 2], [3, 4], [3, 6], [3, 8],
      [6, 0], [6, 2], [6, 4], [6, 6], [6, 8],
    ];
    g.strokeStyle = 'rgba(240,218,166,.8)';
    g.lineWidth = 1.4;
    for (const [r, c] of marks) drawCornerMarks(g, PX(c), PY(r), c);

    // 外沿装饰钉
    for (const [c, r] of [[0, 0], [8, 0], [0, 9], [8, 9]]) {
      g.beginPath();
      g.arc(PX(c), PY(r), 3.4, 0, Math.PI * 2);
      g.fillStyle = '#e8c878';
      g.fill();
    }
    return off;
  }

  function drawSpaced(g, text, x, y, spacing) {
    const chars = text.split('');
    const widths = chars.map((ch) => g.measureText(ch).width);
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (chars.length - 1);
    let cx = x - total / 2;
    chars.forEach((ch, i) => {
      g.fillText(ch, cx + widths[i] / 2, y);
      cx += widths[i] + spacing;
    });
  }

  function drawCornerMarks(g, x, y, c) {
    const gap = 6, len = 9;
    const sides = [
      [1, 1, c < 8], [-1, 1, c > 0], [1, -1, c < 8], [-1, -1, c > 0],
    ];
    for (const [sx, sy, ok] of sides) {
      if (!ok) continue;
      g.beginPath();
      g.moveTo(x + sx * gap, y + sy * (gap + len));
      g.lineTo(x + sx * gap, y + sy * gap);
      g.lineTo(x + sx * (gap + len), y + sy * gap);
      g.stroke();
    }
  }

  function roundRect(g, x, y, w, h, rad) {
    g.beginPath();
    g.moveTo(x + rad, y);
    g.arcTo(x + w, y, x + w, y + h, rad);
    g.arcTo(x + w, y + h, x, y + h, rad);
    g.arcTo(x, y + h, x, y, rad);
    g.arcTo(x, y, x + w, y, rad);
    g.closePath();
  }

  // ---------- 棋子绘制 ----------
  function drawPiece(p, x, y, scale, alpha, rot, noShadow) {
    scale = scale == null ? 1 : scale;
    alpha = alpha == null ? 1 : alpha;
    rot = rot || 0;
    const rad = PIECE_R * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(rot);

    // 落影（腾空动画时由调用方另画地面阴影）
    if (!noShadow) {
      ctx.beginPath();
      ctx.ellipse(2, 5, rad * 0.96, rad * 0.42, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,.4)';
      ctx.fill();
    }

    // 盘体
    const body = ctx.createRadialGradient(-rad * 0.32, -rad * 0.38, rad * 0.15, 0, 0, rad * 1.15);
    if (p.side === 'r') {
      body.addColorStop(0, '#fff7e0');
      body.addColorStop(0.55, '#e7c68c');
      body.addColorStop(1, '#b38342');
    } else {
      body.addColorStop(0, '#565044');
      body.addColorStop(0.55, '#27221b');
      body.addColorStop(1, '#0c0a08');
    }
    ctx.beginPath();
    ctx.arc(0, 0, rad, 0, Math.PI * 2);
    ctx.fillStyle = body;
    ctx.fill();

    // 双环
    ctx.lineWidth = 2.4 * scale;
    ctx.strokeStyle = p.side === 'r' ? '#7c4a1c' : '#d8b567';
    ctx.beginPath();
    ctx.arc(0, 0, rad - 2 * scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1 * scale;
    ctx.strokeStyle = p.side === 'r' ? 'rgba(150,90,30,.75)' : 'rgba(120,100,60,.85)';
    ctx.beginPath();
    ctx.arc(0, 0, rad - 6.5 * scale, 0, Math.PI * 2);
    ctx.stroke();

    // 高光
    ctx.beginPath();
    ctx.arc(-rad * 0.3, -rad * 0.34, rad * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.fill();

    // 字
    const name = R.NAMES[p.side][p.t];
    ctx.font = `bold ${Math.round(34 * scale)}px KaiTi, STKaiti, "楷体", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (p.side === 'r') {
      ctx.fillStyle = '#c4371e';
      ctx.shadowColor = 'rgba(255,180,120,.5)';
    } else {
      ctx.fillStyle = '#ecd6a2';
      ctx.shadowColor = 'rgba(255,210,120,.65)';
    }
    ctx.shadowBlur = 6;
    ctx.fillText(name, 0, 2 * scale);
    ctx.restore();
  }

  // ---------- 游戏流程 ----------
  function newGame(mode, human, level) {
    epoch++; // 旧局所有挂起回调作废
    state.mode = mode;
    state.human = human;
    state.level = level || state.level;
    state.board = R.createBoard();
    state.turn = 'r';
    state.selected = null;
    state.targets = [];
    state.history = [];
    state.anim = null;
    state.thinking = false;
    state.over = false;
    state.winner = null;
    state.endReason = null;
    state.lastMove = null;
    state.checkedSide = null;
    state.slowmo = null;
    state.hitstop = 0;
    state.punch = null;
    state.reps = new Map();
    state.reps.set(positionKey(state.board, 'r'), 1);
    fx.clear();
    hideOverlays();
    renderPanels();
    maybeScheduleAI();
  }

  function humanTurnNow() {
    return state.mode === 'pvp' || state.turn === state.human;
  }

  function onBoardClick(e) {
    sound.unlock();
    if (state.anim || state.thinking || state.over) return;
    if (!humanTurnNow()) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (W / rect.width);
    const y = (e.clientY - rect.top) * (H / rect.height);
    const c = Math.round((x - X0) / CELL);
    const r = Math.round((y - Y0) / CELL);
    const hit = R.inBoard(r, c) ? Math.hypot(x - PX(c), y - PY(r)) : Infinity;
    if (hit > PIECE_R + 6) {
      state.selected = null;
      state.targets = [];
      return;
    }
    const p = state.board[r][c];
    // 已选中 -> 尝试走子
    if (state.selected) {
      const m = state.targets.find((mv) => mv.tr === r && mv.tc === c);
      if (m) {
        attemptMove(m);
        return;
      }
    }
    if (p && p.side === state.turn) {
      state.selected = { r, c };
      state.targets = R.movesFrom(state.board, state.turn, r, c);
      sound.select();
    } else {
      state.selected = null;
      state.targets = [];
      if (p) sound.illegal();
    }
  }

  function attemptMove(m) {
    const mover = state.board[m.fr][m.fc];
    const victim = state.board[m.tr][m.tc];
    state.history.push({
      snapshot: R.cloneBoard(state.board),
      side: state.turn,
      move: m,
      note: R.notation(state.board, m, state.turn),
    });
    if (victim) {
      const cf = attackConf(mover.t);
      state.anim = {
        m, piece: mover, victim, t: 0,
        dur: cf.dur, cap: true, fired: false,
        windQ: cf.wind, dashQ: cf.dash,
      };
    } else {
      state.anim = { m, piece: mover, victim: null, t: 0, dur: MOVE_DUR, cap: false, fired: false };
    }
    state.board[m.fr][m.fc] = null;
    if (victim) state.board[m.tr][m.tc] = null;
    state.selected = null;
    state.targets = [];
  }

  // 命中一瞬：爆裂特效 + 顿帧 + 镜头冲击（在动画 DASH_Q 处触发一次）
  function fireImpact(a) {
    const m = a.m;
    a.fired = true;
    const x = PX(m.tc), y = PY(m.tr);
    try {
      fx.burstCapture(x, y, a.piece.t, R.NAMES[a.victim.side][a.victim.t],
        a.victim.side, { x: m.tc - m.fc, y: m.tr - m.fr });
      sound.capture(a.piece.t);
    } catch (err) {
      console.error('[xiangqi] fx error:', err);
    }
    const royal = a.victim.t === 'k';
    state.hitstop = royal ? HIT_STOP_K : HIT_STOP;
    state.punch = { x, y, t: 0, dur: royal ? 0.5 : 0.34, mag: royal ? 0.09 : 0.05 };
  }

  function finalizeAnim() {
    const a = state.anim;
    const m = a.m;
    state.anim = null; // 先清空：特效即便抛错也不得每帧重复触发
    state.board[m.tr][m.tc] = a.piece;
    state.lastMove = m;
    if (!a.cap) {
      const x = PX(m.tc), y = PY(m.tr);
      try {
        fx.burstMove(x, y, a.piece.side);
        sound.move();
      } catch (err) {
        console.error('[xiangqi] fx error:', err);
      }
    }
    state.turn = R.OTHER[state.turn];
    afterTurn();
  }

  // 吃子动画进程：蓄力（回拉微缩）-> 突进（加速冲刺）-> 命中（顿帧回弹）
  // 各子型吃子演出时序：wind=蓄力段占比，dash=命中时刻占比
  const ATTACK_CONF = {
    r: { dur: 0.42, wind: 0.07, dash: 0.36 }, // 车：快如闪电
    h: { dur: 0.56, wind: 0.14, dash: 0.6 },  // 马：跃起踩踏
    c: { dur: 0.62, wind: 0.24, dash: 0.7 },  // 炮：发射炮弹
    p: { dur: 0.46, wind: 0.14, dash: 0.48 }, // 兵：长矛突刺
  };
  const DEFAULT_ATTACK = { dur: CAP_DUR, wind: WIND_Q, dash: DASH_Q };
  const attackConf = (t) => ATTACK_CONF[t] || DEFAULT_ATTACK;

  const settleK = (q, d, rate) => 1 - Math.exp(-Math.min(1, (q - d) / (1 - d)) * rate);

  // 攻击棋子本体运动（e=路径进度，s=缩放，lift=腾空/向上为负，alpha=渐显）
  function actorMotion(a, q) {
    const w = a.windQ, d = a.dashQ, t = a.piece.t;
    if (t === 'r') { // 车：极短蓄力 -> 闪电突刺
      if (q < w) { const k = q / w; return { e: -0.06 * k, s: 1 - 0.04 * k, lift: 0 }; }
      if (q < d) { const k = (q - w) / (d - w); return { e: k * k, s: 0.96 + 0.12 * k, lift: -3 * Math.sin(k * Math.PI) }; }
      const set = settleK(q, d, 6);
      return { e: 1, s: 1.22 * (1 - set) + set, lift: 0 };
    }
    if (t === 'h') { // 马：小幅后撤 -> 抛物线高高跃起（水平匀速）-> 砸落
      if (q < w) { const k = q / w; return { e: -0.1 * k, s: 0.98 - 0.06 * k, lift: 0 }; }
      if (q < d) { const k = (q - w) / (d - w); return { e: k, s: 1, lift: -42 * Math.sin(k * Math.PI) }; }
      const set = settleK(q, d, 5);
      return { e: 1, s: 1.18 * (1 - set) + set, lift: 0 };
    }
    if (t === 'c') { // 炮：本体原地后座蓄能，命中爆炸后金光瞬移到落点
      if (q < w) { const k = q / w; return { e: -0.05 * k, s: 1 + 0.05 * k, lift: 0 }; }
      if (q < d) return { e: -0.05, s: 1.05, lift: 0 };
      const k = Math.min(1, (q - d) / (1 - d));
      return { e: 1 - Math.pow(1 - k, 3), s: 0.35 + 0.9 * k, lift: 0, alpha: 0.35 + 0.65 * k };
    }
    if (t === 'p') { // 兵：压低身子 -> 挺矛突刺
      if (q < w) { const k = q / w; return { e: -0.12 * k, s: 0.98 - 0.06 * k, lift: 0 }; }
      if (q < d) { const k = (q - w) / (d - w); return { e: k * k, s: 0.94 + 0.1 * k, lift: -4 * Math.sin(k * Math.PI) }; }
      const set = settleK(q, d, 5);
      return { e: 1, s: 1.2 * (1 - set) + set, lift: 0 };
    }
    // 通用（象/士/将）：蓄力彗星突进
    if (q < w) { const k = q / w; return { e: -0.14 * k, s: 0.98 - 0.08 * k, lift: 0 }; }
    if (q < d) { const k = (q - w) / (d - w); return { e: k * k, s: 0.92 + 0.1 * k, lift: -5 * Math.sin(k * Math.PI) }; }
    const set = settleK(q, d, 5);
    return { e: 1, s: 1.24 * (1 - set) + set, lift: 0 };
  }

  // 吃子攻击段的画布特效：聚气收缩环 + 目标预警环 + 突进能量光带
  // 蓄力段：攻击者脚下收缩光环 + 螺旋汇聚火星 + 径向辉光
  function drawWindupFx(sx, sy, col, k) {
    const ringR = 54 - 30 * k;
    ctx.globalAlpha = 0.95 * (1 - k * 0.3);
    ctx.strokeStyle = col;
    ctx.lineWidth = 4;
    ctx.shadowColor = col;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(sx, sy, ringR, 0, TAU);
    ctx.stroke();
    ctx.shadowBlur = 0;
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * TAU + k * 2.2;
      const rr = ringR + 12 - 14 * k;
      ctx.globalAlpha = 0.9 * (1 - k * 0.4);
      ctx.fillStyle = '#fff0b8';
      ctx.beginPath();
      ctx.arc(sx + Math.cos(ang) * rr, sy + Math.sin(ang) * rr, 2.6, 0, TAU);
      ctx.fill();
    }
    const g = ctx.createRadialGradient(sx, sy, 4, sx, sy, 58);
    g.addColorStop(0, 'rgba(255,246,216,.95)');
    g.addColorStop(1, 'rgba(255,200,120,0)');
    ctx.globalAlpha = 0.55 * (1 - k * 0.25);
    ctx.fillStyle = g;
    ctx.fillRect(sx - 58, sy - 58, 116, 116);
  }

  const segPoint = (sx, sy, tx, ty, f) => [sx + (tx - sx) * f, sy + (ty - sy) * f];

  // 突进段顶层光带：压在棋子身上，尖端超前先撞目标；命中后短暂残留
  function drawDashTrail(q, e, w, d, sx, sy, tx, ty, col, opts) {
    opts = opts || {};
    let alpha = 0;
    const maxA = opts.maxA == null ? 0.9 : opts.maxA;
    if (q >= w && q < d) {
      alpha = maxA * (q - w) / (d - w);
    } else if (q >= d) {
      alpha = maxA * Math.max(0, 1 - (q - d) / (opts.fade || 0.18));
    }
    if (alpha <= 0.02 || e <= 0) return;
    const lead = opts.lead == null ? 0.16 : opts.lead;
    const [x0, y0] = segPoint(sx, sy, tx, ty, Math.max(0, e - (opts.tail || 0.5)));
    const [x1, y1] = segPoint(sx, sy, tx, ty, Math.min(1, e + lead));
    ctx.globalAlpha = alpha * 0.8;
    ctx.lineCap = 'round';
    ctx.strokeStyle = col;
    ctx.lineWidth = opts.w || 15;
    ctx.shadowColor = col;
    ctx.shadowBlur = opts.blur == null ? 24 : opts.blur;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255,250,235,.95)';
    ctx.lineWidth = opts.coreW || 5;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  // 车：闪电突刺——主光带外再叠 3 道错位高速残影线
  function drawRookStreak(q, e, w, d, sx, sy, tx, ty, col) {
    drawDashTrail(q, e, w, d, sx, sy, tx, ty, col, { w: 17, blur: 30, tail: 0.7, fade: 0.14 });
    let alpha = 0;
    if (q >= w && q < d) alpha = (q - w) / (d - w);
    else if (q >= d) alpha = Math.max(0, 1 - (q - d) / 0.1);
    if (alpha <= 0.02 || e <= 0) return;
    const dx = tx - sx, dy = ty - sy;
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L; // 路径法向
    ctx.lineCap = 'round';
    for (let i = -1; i <= 1; i++) {
      const off = i * 13 + (i === 0 ? 0 : Math.sin(q * 70) * 2);
      const f0 = Math.max(0, e - 0.62), f1 = Math.min(1, e + 0.04);
      const [x0, y0] = segPoint(sx, sy, tx, ty, f0);
      const [x1, y1] = segPoint(sx, sy, tx, ty, f1);
      ctx.globalAlpha = alpha * 0.55;
      ctx.strokeStyle = i === 0 ? '#ffffff' : col;
      ctx.lineWidth = i === 0 ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(x0 + nx * off, y0 + ny * off);
      ctx.lineTo(x1 + nx * off, y1 + ny * off);
      ctx.stroke();
    }
  }

  // 兵：长矛突刺——金杆 + 矛尖，突进段快速刺出
  function drawSpear(q, w, d, sx, sy, tx, ty, col, e) {
    if (q < w || e <= 0) return;
    const k = q < d ? (q - w) / (d - w) : 1;
    const stab = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const dx = tx - sx, dy = ty - sy;
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    const reach = 26 + 30 * stab;
    const tip = [sx + ux * (L * e + reach), sy + uy * (L * e + reach)];
    const base = [tip[0] - ux * (reach + 16), tip[1] - uy * (reach + 16)];
    ctx.globalAlpha = 0.95;
    ctx.lineCap = 'round';
    ctx.strokeStyle = col;
    ctx.lineWidth = 4;
    ctx.shadowColor = col;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(base[0], base[1]);
    ctx.lineTo(tip[0], tip[1]);
    ctx.stroke();
    ctx.shadowBlur = 0;
    const px = -uy, py = ux;
    ctx.fillStyle = '#fff6d8';
    ctx.beginPath();
    ctx.moveTo(tip[0] + ux * 11, tip[1] + uy * 11);
    ctx.lineTo(tip[0] + px * 5, tip[1] + py * 5);
    ctx.lineTo(tip[0] - ux * 3, tip[1] - uy * 3);
    ctx.lineTo(tip[0] - px * 5, tip[1] - py * 5);
    ctx.closePath();
    ctx.fill();
  }

  // 炮：炮膛蓄能火球（围绕炮身）
  function drawCannonCharge(q, w, d, sx, sy, col) {
    if (q < w || q >= d) return;
    const k = (q - w) / (d - w);
    const flick = 0.8 + 0.2 * Math.sin(q * 60);
    const r = 12 + 14 * k;
    const g = ctx.createRadialGradient(sx, sy, 1, sx, sy, r + 14);
    g.addColorStop(0, 'rgba(255,246,200,' + (0.95 * flick) + ')');
    g.addColorStop(0.5, 'rgba(255,170,60,' + (0.6 * flick) + ')');
    g.addColorStop(1, 'rgba(255,120,30,0)');
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.fillRect(sx - r - 14, sy - r - 14, (r + 14) * 2, (r + 14) * 2);
    ctx.globalAlpha = 0.9 * flick;
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(sx, sy, r + 3, 0, TAU);
    ctx.stroke();
  }

  // 炮：出膛闪光（命中前一瞬）
  function drawMuzzle(q, w, d, sx, sy) {
    const mk = (q - (d - 0.07)) / 0.07;
    if (mk <= 0 || mk > 1) return;
    ctx.globalAlpha = 1 - mk;
    const g = ctx.createRadialGradient(sx, sy, 1, sx, sy, 26 + 14 * mk);
    g.addColorStop(0, 'rgba(255,255,235,1)');
    g.addColorStop(0.6, 'rgba(255,200,90,.7)');
    g.addColorStop(1, 'rgba(255,150,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(sx - 42, sy - 42, 84, 84);
  }

  // 炮：飞行的炮弹 + 余焰（顶层）
  function drawShell(q, w, d, sx, sy, tx, ty, col) {
    if (q < w || q >= d) return;
    const k = (q - w) / (d - w);
    const [x, y] = segPoint(sx, sy, tx, ty, k);
    for (let i = 1; i <= 5; i++) {
      const [ex, ey] = segPoint(sx, sy, tx, ty, Math.max(0, k - i * 0.035));
      ctx.globalAlpha = 0.55 - i * 0.09;
      ctx.fillStyle = i <= 2 ? '#ffe9a8' : col;
      ctx.beginPath();
      ctx.arc(ex, ey, 5.5 - i * 0.7, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.shadowColor = '#ffcf6a';
    ctx.shadowBlur = 22;
    const g = ctx.createRadialGradient(x - 1.5, y - 1.5, 0.5, x, y, 7);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.55, '#ffd98a');
    g.addColorStop(1, '#ff8a30');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 6.5, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // 马：沿抛物线的金色蹄尘点（不用彗星光带）
  function drawHorseArc(q, w, d, sx, sy, tx, ty, col) {
    if (q < w || q >= d) return;
    const k = (q - w) / (d - w);
    for (let i = 1; i <= 8; i++) {
      const kk = k - i * 0.05;
      if (kk <= 0) continue;
      const [x, y] = segPoint(sx, sy, tx, ty, kk);
      ctx.globalAlpha = 0.4 * (1 - i / 9);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y - 42 * Math.sin(kk * Math.PI), 3.4 - i * 0.24, 0, TAU);
      ctx.fill();
    }
  }

  // 命中前预警环：奶白普通环 / 马的重蹄琥珀大环
  function drawWarnRing(tx, ty, k, heavy) {
    ctx.globalAlpha = (heavy ? 1 : 0.95) - k * 0.4;
    ctx.strokeStyle = heavy ? '#ffb84d' : '#fff3c4';
    ctx.lineWidth = (heavy ? 7 : 5) * (1 - k) + (heavy ? 2.5 : 1.5);
    ctx.shadowColor = heavy ? '#ff8a20' : '#ffd870';
    ctx.shadowBlur = heavy ? 18 : 12;
    ctx.beginPath();
    ctx.arc(tx, ty, (heavy ? 24 : 20) + (heavy ? 30 : 24) * k, 0, TAU);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // layer='top' 在主体棋子之后画（燃光压身），否则在棋子之前画底层
  function drawCaptureFx(a, q, sx, sy, tx, ty, e, layer) {
    const t = a.piece.t;
    const col = window.XQFX.captureColor(t);
    const w = a.windQ, d = a.dashQ;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    if (layer === 'top') {
      if (t === 'r') drawRookStreak(q, e, w, d, sx, sy, tx, ty, col);
      else if (t === 'p') {
        drawDashTrail(q, e, w, d, sx, sy, tx, ty, col,
          { w: 9, coreW: 3, blur: 16, tail: 0.35, maxA: 0.5, lead: 0.1 });
        drawSpear(q, w, d, sx, sy, tx, ty, col, e);
      } else if (t === 'c') drawShell(q, w, d, sx, sy, tx, ty, col);
      else if (t === 'h') drawHorseArc(q, w, d, sx, sy, tx, ty, col);
      else drawDashTrail(q, e, w, d, sx, sy, tx, ty, col);
    } else {
      if (q < w) drawWindupFx(sx, sy, col, q / w);
      if (t === 'c') {
        drawCannonCharge(q, w, d, sx, sy, col);
        drawMuzzle(q, w, d, sx, sy);
      }
      const lead = t === 'h' ? 0.16 : 0.12; // 马跃起早给落点预警
      const warn0 = d - lead;
      if (q >= warn0 && q < d) {
        drawWarnRing(tx, ty, (q - warn0) / (d - warn0), t === 'h');
      }
    }
    ctx.restore();
  }

  function afterTurn() {
    const st = R.status(state.board, state.turn);
    state.checkedSide = st === 'check' ? state.turn : null;
    renderPanels();
    if (st === 'checkmate' || st === 'stalemate') {
      gameOver(R.OTHER[state.turn], st);
      return;
    }
    // 三次重复局面 -> 和棋（防长将/无限循环）
    const key = positionKey(state.board, state.turn);
    const n = (state.reps.get(key) || 0) + 1;
    state.reps.set(key, n);
    if (n >= 3) {
      gameDraw('repetition');
      return;
    }
    if (st === 'check') {
      sound.check();
      showToast('将 军 ！');
    } else {
      hideToast();
    }
    maybeScheduleAI();
  }

  function maybeScheduleAI() {
    if (state.mode !== 'pve' || state.over) return;
    if (state.turn === state.human) return;
    state.thinking = true;
    renderPanels();
    const board = R.cloneBoard(state.board);
    const side = state.turn;
    const my = epoch;
    setTimeout(function () {
      if (my !== epoch) return; // 搜索期间已重开/悔棋
      const res = window.XQAI.chooseMove(board, side, state.level);
      if (my !== epoch) return;
      state.thinking = false;
      if (state.over) return;
      if (res.move) attemptMove(res.move);
      else gameOver(state.human, R.status(state.board, side) === 'stalemate' ? 'stalemate' : 'checkmate');
    }, 120);
  }

  function gameOver(winner, reason) {
    const my = epoch;
    state.over = true;
    state.winner = winner;
    state.endReason = reason;
    state.checkedSide = null;
    hideToast();
    const loser = R.OTHER[winner];
    const kp = R.findKing(state.board, loser);
    // 终局大招：金龙 + 绝杀 + 慢镜头（独立皇家爆裂，不与普通吃子混淆）
    try { fx.burstRoyal(PX(kp.c), PY(kp.r), R.NAMES[loser].k, loser); sound.capture('k'); }
    catch (err) { console.error('[xiangqi] fx error:', err); }
    state.slowmo = { t: 0, dur: 1.15 };
    fx.addShake(6);
    const humanWon = state.mode === 'pvp' || winner === state.human;
    setTimeout(function () {
      if (my !== epoch) return;
      humanWon ? sound.win() : sound.lose();
    }, 650);
    setTimeout(function () { if (my === epoch) showGameOver(); }, 1150);
    renderPanels();
  }

  // 和棋（三次重复局面）
  function gameDraw(reason) {
    const my = epoch;
    state.over = true;
    state.winner = null;
    state.endReason = reason;
    state.checkedSide = null;
    hideToast();
    fx.addShake(4);
    sound.ui();
    setTimeout(function () { if (my === epoch) showGameOver(); }, 700);
    renderPanels();
  }

  function undo() {
    if (state.anim || state.thinking) return;
    if (!state.history.length) return;
    epoch++; // 作废旧局回调（终局浮层/音效）
    sound.ui();
    do {
      const h = state.history.pop();
      state.board = R.cloneBoard(h.snapshot);
      state.turn = h.side;
    } while (state.mode === 'pve' && state.history.length > 0 && state.turn !== state.human);
    state.over = false;
    state.winner = null;
    state.endReason = null;
    state.lastMove = state.history.length ? state.history[state.history.length - 1].move : null;
    state.selected = null;
    state.targets = [];
    state.slowmo = null;
    state.hitstop = 0;
    state.punch = null;
    rebuildReps();
    hideOverlays();
    const st = R.status(state.board, state.turn);
    state.checkedSide = st === 'check' ? state.turn : null;
    fx.clear();
    renderPanels();
    // 执黑时悔掉 AI 首着会停在 AI 回合，需重新调度，否则棋盘僵死
    if (state.mode === 'pve' && state.turn !== state.human) maybeScheduleAI();
  }

  // ---------- 渲染 ----------
  function render(now) {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(fx.shakeX || 0, fx.shakeY || 0);
    // 命中镜头冲击：以受击点为中心短暂放大
    if (state.punch) {
      const pu = state.punch;
      const k = pu.mag * Math.exp((-pu.t / pu.dur) * 6);
      ctx.translate(pu.x, pu.y);
      ctx.scale(1 + k, 1 + k);
      ctx.translate(-pu.x, -pu.y);
    }
    ctx.drawImage(boardLayer, 0, 0);

    // 上一步痕迹
    if (state.lastMove) {
      const m = state.lastMove;
      for (const [r, c] of [[m.fr, m.fc], [m.tr, m.tc]]) {
        ctx.fillStyle = 'rgba(255,205,90,.16)';
        roundRect(ctx, PX(c) - CELL / 2 + 5, PY(r) - CELL / 2 + 5, CELL - 10, CELL - 10, 8);
        ctx.fill();
      }
    }

    // 被将军的将：红框脉动
    if (state.checkedSide) {
      const kp = R.findKing(state.board, state.checkedSide);
      if (kp) {
        const pulse = 0.5 + 0.5 * Math.sin(now * 7);
        ctx.save();
        ctx.strokeStyle = `rgba(255,60,40,${0.55 + pulse * 0.4})`;
        ctx.lineWidth = 3 + pulse * 2;
        roundRect(ctx, PX(kp.c) - 34, PY(kp.r) - 34, 68, 68, 10);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 选中环 + 落点提示
    if (state.selected) {
      const { r, c } = state.selected;
      const pulse = 0.5 + 0.5 * Math.sin(now * 6);
      ctx.save();
      ctx.strokeStyle = `rgba(255,225,130,${0.7 + pulse * 0.3})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(PX(c), PY(r), PIECE_R + 5 + pulse * 2.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      for (const m of state.targets) {
        const tx = PX(m.tc), ty = PY(m.tr);
        if (m.cap) {
          const a = now * 2.4;
          ctx.save();
          ctx.strokeStyle = 'rgba(255,80,50,.9)';
          ctx.lineWidth = 3;
          ctx.setLineDash([10, 6]);
          ctx.lineDashOffset = -a * 10;
          ctx.beginPath();
          ctx.arc(tx, ty, PIECE_R + 5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        } else {
          ctx.fillStyle = 'rgba(255,220,130,.55)';
          ctx.beginPath();
          ctx.arc(tx, ty, 7, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = 'rgba(255,230,160,.8)';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(tx, ty, 10 + Math.sin(now * 5) * 1.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // 被吃子：命中前留在终点（受击瞬间一胀），命中后交给爆裂碎片
    if (state.anim && state.anim.victim && !state.anim.fired) {
      const a = state.anim;
      const q = Math.min(1, a.t / a.dur);
      const braceQ = a.dashQ - 0.09;
      const sc = q > braceQ
        ? 1 + Math.sin(((q - braceQ) / (DASH_Q - braceQ)) * Math.PI) * 0.14
        : 1;
      drawPiece(a.victim, PX(a.m.tc), PY(a.m.tr), sc, 1, 0);
    }

    // 棋盘棋子（跳过动画格）
    const skip = {};
    if (state.anim) {
      skip[state.anim.m.fr + ',' + state.anim.m.fc] = true;
      skip[state.anim.m.tr + ',' + state.anim.m.tc] = true;
    }
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        if (skip[r + ',' + c]) continue;
        const p = state.board[r][c];
        if (p) drawPiece(p, PX(c), PY(r));
      }
    }

    // 行动棋子（吃子=各子型专属攻击演出；普通=小跳落子；均带残影与地面影）
    const GHOST_CONF = { r: { n: 8, step: 0.02, a: 0.1 }, h: { n: 6, step: 0.034, a: 0.15 }, c: { n: 0 } };
    if (state.anim) {
      const a = state.anim;
      const q = Math.min(1, a.t / a.dur);
      const sx = PX(a.m.fc), sy = PY(a.m.fr), txp = PX(a.m.tc), typ = PY(a.m.tr);
      let e, sc = 1, lift = 0, alpha = 1;
      if (a.cap) {
        const mo = actorMotion(a, q);
        e = mo.e; sc = mo.s; lift = mo.lift; alpha = mo.alpha == null ? 1 : mo.alpha;
        drawCaptureFx(a, q, sx, sy, txp, typ, e);
      } else {
        e = 1 - Math.pow(1 - q, 3);
        lift = -Math.sin(Math.PI * q) * 14;
      }
      const gx = sx + (txp - sx) * e;
      const gy = sy + (typ - sy) * e;

      // 地面落影（腾空时独立于棋子，跳得越高影子越小越淡）
      if (lift < -0.5) {
        const sh = Math.max(0.45, 1 + lift * 0.014);
        ctx.save();
        ctx.globalAlpha = 0.42 * sh + 0.08;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(gx, gy + 7, PIECE_R * 0.92 * sh, PIECE_R * 0.4 * sh, 0, 0, TAU);
        ctx.fill();
        ctx.restore();
      }

      // 残影（炮瞬移无残影；车 8 道高速残影；马沿抛物线）
      const gc = a.cap ? (GHOST_CONF[a.piece.t] || { n: 5, step: 0.032, a: 0.17 })
        : { n: 3, step: 0, a: 0 };
      for (let i = 1; i <= gc.n; i++) {
        let gex, ges, geLift, galpha;
        if (a.cap) {
          const qb = q - i * gc.step;
          if (qb < a.windQ) continue;
          const mb = actorMotion(a, Math.max(0, qb));
          gex = mb.e; ges = mb.s; geLift = mb.lift;
          galpha = a.piece.t === 'r' ? Math.max(0.04, gc.a - i * 0.008) : gc.a;
        } else {
          gex = Math.max(0, e - i * 0.05); ges = 1;
          geLift = -Math.sin(Math.PI * Math.min(1, gex)) * 14;
          galpha = 0.16 - i * 0.04;
        }
        drawPiece(a.piece, sx + (txp - sx) * gex, sy + (typ - sy) * gex + geLift,
          ges, galpha, 0, geLift < -0.5);
      }

      drawPiece(a.piece, gx, gy + lift, sc, alpha, 0, lift < -0.5);
      if (a.cap) drawCaptureFx(a, q, sx, sy, txp, typ, e, 'top');
    }

    fx.render(ctx);
    ctx.restore();
  }

  // ---------- 主循环 ----------
  let lastT = performance.now();
  function tick(now) {
    const rawDt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    // 测试用：冻结动画推进（拖帧截图），仍刷新 lastT 防解冻后 dt 跳变
    if (window.__xqFreeze) return;
    let timeScale = 1;
    if (state.slowmo) {
      state.slowmo.t += rawDt;
      const q = Math.min(1, state.slowmo.t / state.slowmo.dur);
      timeScale = 0.25 + 0.75 * (q * q);
      if (q >= 1) state.slowmo = null;
    }
    let dt = rawDt * timeScale;
    // 命中顿帧：冻结 anim/粒子推进，但镜头与计时仍走真实时间
    if (state.hitstop > 0) {
      state.hitstop = Math.max(0, state.hitstop - rawDt);
      dt = 0;
    }
    if (state.punch) {
      state.punch.t += rawDt;
      if (state.punch.t >= state.punch.dur) state.punch = null;
    }
    if (state.anim) {
      state.anim.t += dt;
      const a = state.anim;
      if (a.cap && !a.fired && Math.min(1, a.t / a.dur) >= a.dashQ) fireImpact(a);
      if (state.anim && state.anim.t >= state.anim.dur) finalizeAnim();
    }
    fx.update(dt);
    render(now / 1000);
  }

  // 任何一帧抛错都不得杀死渲染循环（MED-3）
  function frame(now) {
    try { tick(now); } catch (err) { console.error('[xiangqi] frame error:', err); }
    requestAnimationFrame(frame);
  }

  // ---------- 侧栏 / 浮层 ----------
  const el = (id) => document.getElementById(id);

  function renderPanels() {
    // 回合状态
    const lamp = el('turn-lamp');
    const text = el('turn-text');
    lamp.className = 'lamp ' + (state.turn === 'r' ? 'red' : 'black');
    if (state.over) {
      text.textContent = state.winner == null ? '和棋' : (state.winner === 'r' ? '红方' : '黑方') + '胜';
    } else if (state.thinking) {
      text.textContent = '玄机子思索中…';
    } else {
      text.textContent = (state.turn === 'r' ? '红方' : '黑方') + '行棋';
    }

    // 缴获 + 子力
    const cap = { r: [], b: [] };
    for (const h of state.history) {
      if (h.move.cap) cap[h.side].push({ t: h.move.cap, side: h.side === 'r' ? 'b' : 'r' });
    }
    drawTray(el('tray-r'), cap.r);
    drawTray(el('tray-b'), cap.b);
    let diff = 0;
    for (const p of cap.r) diff += R.VALUES[p.t];
    for (const p of cap.b) diff -= R.VALUES[p.t];
    el('material').textContent = diff === 0 ? '子力均势' : (diff > 0 ? '红方领先 ' : '黑方领先 ') + Math.abs(diff);

    // 棋谱
    const list = el('movelist');
    let html = '';
    for (let i = 0; i < state.history.length; i += 2) {
      const no = i / 2 + 1;
      const red = state.history[i] ? state.history[i].note : '';
      const black = state.history[i + 1] ? state.history[i + 1].note : '';
      const curR = state.history[i] && state.history.length - 1 === i;
      const curB = state.history[i + 1] && state.history.length - 1 === i + 1;
      html += `<li><span class="no">${no}.</span><span class="mv ${curR ? 'cur' : ''}">${red}</span><span class="mv ${curB ? 'cur' : ''}">${black}</span></li>`;
    }
    list.innerHTML = html;
    list.scrollTop = list.scrollHeight;
  }

  function drawTray(node, pieces) {
    node.innerHTML = '';
    for (const p of pieces) {
      const s = document.createElement('span');
      s.className = 'mini ' + (p.side === 'r' ? 'mini-r' : 'mini-b');
      s.textContent = R.NAMES[p.side][p.t];
      node.appendChild(s);
    }
  }

  let toastTimer = null;
  function showToast(t) {
    const toast = el('toast');
    toast.textContent = t;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 1500);
  }
  function hideToast() {
    el('toast').classList.remove('show');
  }

  function showGameOver() {
    const o = el('over');
    if (state.winner == null) {
      el('over-title').textContent = '和 棋';
      el('over-title').className = 'gold-text';
      el('over-sub').textContent = state.endReason === 'repetition' ? '三次重复局面，握手言和' : '握手言和';
      o.classList.add('show');
      return;
    }
    el('over-title').textContent = (state.winner === 'r' ? '红 方 胜' : '黑 方 胜');
    el('over-title').className = state.winner === 'r' ? 'red-text' : 'gold-text';
    const reasonText = state.endReason === 'stalemate' ? '困毙无着' : '绝杀无解';
    el('over-sub').textContent = state.mode === 'pve'
      ? (state.winner === state.human ? reasonText + '，棋高一着' : reasonText + '，再战一局？')
      : reasonText;
    o.classList.add('show');
  }
  function hideOverlays() {
    el('over').classList.remove('show');
    el('menu').classList.remove('show');
  }

  // ---------- 绑定 ----------
  canvas.addEventListener('pointerdown', onBoardClick);

  el('btn-undo').addEventListener('click', function () {
    sound.unlock();
    undo();
  });
  el('btn-restart').addEventListener('click', function () {
    sound.unlock();
    sound.ui();
    newGame(state.mode, state.human, state.level);
  });
  el('btn-menu').addEventListener('click', function () {
    sound.unlock();
    sound.ui();
    el('menu').classList.add('show');
  });
  el('btn-mute').addEventListener('click', function () {
    sound.unlock();
    const b = el('btn-mute');
    b.classList.toggle('muted');
    sound.setMuted(b.classList.contains('muted'));
  });
  el('level-select').addEventListener('change', function (e) {
    state.level = Number(e.target.value);
  });

  el('start-pvp').addEventListener('click', function () {
    sound.unlock(); sound.ui();
    newGame('pvp', 'r', Number(el('menu-level').value));
  });
  el('start-r').addEventListener('click', function () {
    sound.unlock(); sound.ui();
    newGame('pve', 'r', Number(el('menu-level').value));
  });
  el('start-b').addEventListener('click', function () {
    sound.unlock(); sound.ui();
    newGame('pve', 'b', Number(el('menu-level').value));
  });
  el('over-again').addEventListener('click', function () {
    sound.unlock(); sound.ui();
    newGame(state.mode, state.human, state.level);
  });
  el('over-menu').addEventListener('click', function () {
    sound.unlock(); sound.ui();
    hideOverlays();
    el('menu').classList.add('show');
  });

  // ---------- 启动 ----------
  fitCanvas();
  window.addEventListener('resize', fitCanvas);
  boardLayer = buildBoardLayer();
  el('menu').classList.add('show');
  renderPanels();
  requestAnimationFrame(frame);

  // 调试 / CDP 冒烟钩子：观察攻击动画内部状态
  window.__xqDbg = function () {
    return {
      anim: !!state.anim,
      cap: !!(state.anim && state.anim.cap),
      fired: !!(state.anim && state.anim.fired),
      hitstop: state.hitstop,
      punch: !!state.punch,
      fx: fx.list.length,
    };
  };

  // 测试用：在「红兵(5,4) 吃黑卒(4,4)」局面下把吃子动画拖到指定相位并同步渲染一帧
  // q: 动画进度 0..1；fxAge: 命中后粒子额外推进秒数（用于爆裂扩散静帧）
  // 测试用：摆一个极简吃子局面，把攻击动画拖到指定相位并同步渲染一帧
  // kind: 'p' 兵刺 / 'r' 车闪 / 'h' 马踏 / 'c' 炮轰；q: 动画进度；fxAge: 粒子额外推进秒数
  window.__xqScrubCapture = function (kind, q, fxAge) {
    kind = kind || 'p';
    const board = [];
    for (let r = 0; r < 10; r++) board.push(new Array(9).fill(null));
    const RP = (t) => ({ t, side: 'r', id: 't' + t });
    const BP = (t) => ({ t, side: 'b', id: 'tb' + t });
    // 无王局面 isInCheck 恒真，所有走法会被合法过滤；双王坐宫且被攻击线子隔开
    board[9][4] = RP('k');
    board[0][4] = BP('k');
    let fr, fc, tr, tc;
    if (kind === 'r') {
      board[5][4] = RP('r'); board[4][4] = BP('p');
      fr = 5; fc = 4; tr = 4; tc = 4;
    } else if (kind === 'h') {
      board[6][3] = RP('h'); board[4][4] = BP('p'); // (6,3)->(4,4) 日字，(5,3) 空不蹩腿
      fr = 6; fc = 3; tr = 4; tc = 4;
    } else if (kind === 'c') {
      board[5][4] = RP('c'); board[4][4] = RP('p'); board[3][4] = BP('p'); // 隔山打牛
      fr = 5; fc = 4; tr = 3; tc = 4;
    } else {
      board[5][4] = RP('p'); board[4][4] = BP('p');
      fr = 5; fc = 4; tr = 4; tc = 4;
    }
    state.board = board;
    state.turn = 'r';
    state.anim = null;
    state.hitstop = 0;
    state.punch = null;
    state.checkedSide = null;
    state.selected = null;
    state.targets = [];
    const mv = R.movesFrom(board, 'r', fr, fc).find((x) => x.tr === tr && x.tc === tc && x.cap);
    if (!mv) return { error: 'no capture move', kind };
    fx.clear();
    attemptMove(mv);
    const a = state.anim;
    a.t = Math.min(0.999, q) * a.dur;
    if (q >= a.dashQ && !a.fired) fireImpact(a);
    if (fxAge > 0) fx.update(fxAge);
    render(performance.now() / 1000);
    const dbg = window.__xqDbg();
    dbg.kind = kind;
    dbg.dashQ = a.dashQ;
    return dbg;
  };
})();
