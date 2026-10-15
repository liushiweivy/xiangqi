/*
 * 鎏金象棋 - 主程序（状态机 / 渲染 / 交互 / 动画）
 */
(function () {
  'use strict';

  const R = window.XQRules;
  const W = 720;
  const H = 800;
  const CELL = 76;
  const X0 = 56;
  const Y0 = 52;
  const PX = (c) => X0 + c * CELL;
  const PY = (r) => Y0 + r * CELL;
  const PIECE_R = 31;

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
  function drawPiece(p, x, y, scale, alpha, rot) {
    scale = scale == null ? 1 : scale;
    alpha = alpha == null ? 1 : alpha;
    rot = rot || 0;
    const rad = PIECE_R * scale;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(rot);

    // 落影
    ctx.beginPath();
    ctx.ellipse(2, 5, rad * 0.96, rad * 0.42, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.fill();

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
    state.anim = { m, piece: mover, victim, t: 0, dur: victim ? 0.3 : 0.22 };
    state.board[m.fr][m.fc] = null;
    if (victim) state.board[m.tr][m.tc] = null;
    state.selected = null;
    state.targets = [];
  }

  function finalizeAnim() {
    const a = state.anim;
    const m = a.m;
    state.anim = null; // 先清空：特效即便抛错也不得每帧重复触发
    state.board[m.tr][m.tc] = a.piece;
    state.lastMove = m;
    const x = PX(m.tc), y = PY(m.tr);
    try {
      if (a.victim) {
        fx.burstCapture(x, y, a.piece.t, R.NAMES[a.victim.side][a.victim.t],
          a.victim.side, { x: m.tc - m.fc, y: m.tr - m.fr });
        sound.capture(a.piece.t);
      } else {
        fx.burstMove(x, y, a.piece.side);
        sound.move();
      }
    } catch (err) {
      console.error('[xiangqi] fx error:', err);
    }
    state.turn = R.OTHER[state.turn];
    afterTurn();
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

    // 被吃子（动画期间留在终点，受击前抖动）
    if (state.anim && state.anim.victim) {
      const a = state.anim;
      const q = Math.min(1, a.t / a.dur);
      let sc = 1, rot = 0, alpha = 1;
      if (q > 0.72) {
        const k = (q - 0.72) / 0.28;
        sc = 1 + Math.sin(k * Math.PI) * 0.25;
        rot = Math.sin(k * 40) * 0.06;
        alpha = 1 - k * 0.35;
      }
      drawPiece(a.victim, PX(a.m.tc), PY(a.m.tr), sc, alpha, rot);
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

    // 行动棋子（拖尾 + 插值）
    if (state.anim) {
      const a = state.anim;
      const q = Math.min(1, a.t / a.dur);
      const e = 1 - Math.pow(1 - q, 3);
      const x = PX(a.m.fc) + (PX(a.m.tc) - PX(a.m.fc)) * e;
      const y = PY(a.m.fr) + (PY(a.m.tr) - PY(a.m.fr)) * e;
      for (let i = 1; i <= 3; i++) {
        const back = i * 0.05;
        const qe = Math.max(0, e - back);
        const tx = PX(a.m.fc) + (PX(a.m.tc) - PX(a.m.fc)) * qe;
        const ty = PY(a.m.fr) + (PY(a.m.tr) - PY(a.m.fr)) * qe;
        drawPiece(a.piece, tx, ty, 1 - i * 0.06, 0.16 - i * 0.04, 0);
      }
      const land = q > 0.9 ? 1 - (q - 0.9) / 0.1 : 1;
      drawPiece(a.piece, x, y, 1 + (1 - land) * 0.12, 1, 0);
    }

    fx.render(ctx);
    ctx.restore();
  }

  // ---------- 主循环 ----------
  let lastT = performance.now();
  function tick(now) {
    const rawDt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    let timeScale = 1;
    if (state.slowmo) {
      state.slowmo.t += rawDt;
      const q = Math.min(1, state.slowmo.t / state.slowmo.dur);
      timeScale = 0.25 + 0.75 * (q * q);
      if (q >= 1) state.slowmo = null;
    }
    const dt = rawDt * timeScale;
    if (state.anim) {
      state.anim.t += dt;
      if (state.anim.t >= state.anim.dur) finalizeAnim();
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
})();
