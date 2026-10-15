/*
 * 鎏金象棋 - AI（negamax + alpha-beta，纯逻辑 UMD）
 * 难度: 1=新手(浅算+随机) 2=高手(3层) 3=大师(4层)
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(require('./rules.js'));
  else root.XQAI = factory(root.XQRules);
})(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  const MATE = 90000;
  const NODE_BUDGET = 800000; // 硬上限（墙钟截止失效时的兜底）
  const QMAX = 5;             // 静止搜索最大吃子链深度
  // 每档：最大搜索深度 + 墙钟预算（ms）。迭代加深，超时返回上一完整深度结果
  const LEVEL_CONF = {
    1: { depth: 1, time: 400 },
    2: { depth: 3, time: 900 },
    3: { depth: 4, time: 1800 },
  };

  // 位置加分（从该子行棋方视角，越向前压越有侵略性）
  // 兵：过河后大幅增值并鼓励深入
  function pstScore(p, r, c) {
    if (p.t === 'p') {
      if (!R.pawnCrossed(p.side, r)) return 0;
      const depth = p.side === 'b' ? r - 4 : 5 - r; // 过河深入 1..5
      return 30 + depth * 14;
    }
    if (p.t === 'h' || p.t === 'c' || p.t === 'r') {
      // 中线附近小幅加成
      const central = 8 - Math.abs(c - 4) * 3;
      const forward = p.t === 'r' ? 0 : (p.side === 'b' ? r : 9 - r) * 2;
      return central + forward;
    }
    return 0;
  }

  // 静态评估，返回 side 视角的局面分
  function evaluate(b, side) {
    let red = 0;
    for (let r = 0; r < R.ROWS; r++) {
      for (let c = 0; c < R.COLS; c++) {
        const p = b[r][c];
        if (!p) continue;
        let v = R.VALUES[p.t] + pstScore(p, r, c);
        red += p.side === 'r' ? v : -v;
      }
    }
    return side === 'r' ? red : -red;
  }

  function orderMoves(b, moves) {
    // MVV-LVA：吃大子、用小子优先
    for (const m of moves) {
      m._s = m.cap ? 10 * R.VALUES[m.cap] - R.VALUES[b[m.fr][m.fc].t] : 0;
    }
    moves.sort((a, b2) => b2._s - a._s);
    return moves;
  }

  function makeEngine(depth, deadline) {
    let nodes = 0;
    let aborted = false;

    // 每 2048 节点看一次墙钟（Date.now 有成本，避免逐节点调用）
    function timeUp() {
      if ((nodes & 2047) === 0 && Date.now() > deadline) aborted = true;
      return aborted;
    }

    // 静止搜索：叶子只继续吃子（被将军时全宽应将），治愈浅搜的贪子幻觉
    // 注意：fail-soft 语义，必须返回真实最佳值而非窗口界，否则窄窗口下
    // "无改善"会被上层当成杀棋分传播
    function quies(b, side, alpha, beta, qply, ply) {
      if (++nodes > NODE_BUDGET) { aborted = true; return evaluate(b, side); }
      if (timeUp()) return evaluate(b, side);
      const inCheck = R.isInCheck(b, side);
      let moves;
      let best;
      if (inCheck) {
        moves = R.legalMoves(b, side);
        if (moves.length === 0) return -MATE + ply;
        best = -Infinity;
      } else {
        best = evaluate(b, side);
        if (best >= beta) return best;
        if (best > alpha) alpha = best;
        if (qply >= QMAX) return best;
        moves = R.genPseudo(b, side).filter((m) => m.cap);
      }
      orderMoves(b, moves);
      for (const m of moves) {
        const nb = R.applyMove(b, m);
        if (!inCheck && R.isInCheck(nb, side)) continue; // 吃子也不能送将
        const score = -quies(nb, R.OTHER[side], -beta, -alpha, qply + 1, ply + 1);
        if (score > best) best = score;
        if (score > alpha) alpha = score;
        if (alpha >= beta) break;
      }
      return best;
    }

    function negamax(b, side, dep, alpha, beta, ply) {
      if (aborted) return { score: evaluate(b, side) };
      if (++nodes > NODE_BUDGET) { aborted = true; return { score: evaluate(b, side) }; }
      if (timeUp()) return { score: evaluate(b, side) };
      const moves = R.legalMoves(b, side);
      if (moves.length === 0) return { score: -MATE + ply };
      if (dep === 0) return { score: quies(b, side, alpha, beta, 0, ply) };

      orderMoves(b, moves);
      let bestScore = -Infinity;
      let bestMoves = [moves[0]];
      for (const m of moves) {
        const nb = R.applyMove(b, m);
        const child = negamax(nb, R.OTHER[side], dep - 1, -beta, -alpha, ply + 1);
        const score = -child.score;
        if (score > bestScore) {
          bestScore = score;
          bestMoves = [m];
        } else if (score === bestScore) {
          bestMoves.push(m);
        }
        if (score > alpha) alpha = score;
        if (alpha >= beta) break;
      }
      return { score: bestScore, moves: bestMoves };
    }

    return {
      search(b, side) {
        nodes = 0;
        aborted = false;
        const result = negamax(b, side, depth, -Infinity, Infinity, 0);
        return { moves: result.moves || [], score: result.score, nodes, aborted };
      },
    };
  }

  // 确定性 PRNG（mulberry32），便于测试复现
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 返回走法（含耗时/节点统计）
  // 迭代加深：1..maxDepth 逐层搜，墙钟到点即停，永远采用"完整跑完"的最深层结果
  function chooseMove(b, side, level, seed) {
    const conf = LEVEL_CONF[level >= 3 ? 3 : level === 2 ? 2 : 1];
    const deadline = Date.now() + conf.time;
    const t0 = Date.now();
    let result = null;
    let totalNodes = 0;
    let aborted = false;
    for (let d = 1; d <= conf.depth; d++) {
      const r = makeEngine(d, deadline).search(b, side);
      totalNodes += r.nodes;
      if (r.aborted) { aborted = true; break; }
      result = r;
    }
    const elapsed = Date.now() - t0;
    const moves = result && result.moves.length ? result.moves : R.legalMoves(b, side);
    const score = result ? result.score : 0;
    let pick;
    if (moves.length === 0) {
      return { move: null, score, nodes: totalNodes, elapsed, aborted };
    }
    if (level <= 1) {
      // 新手：只在与最佳着差距小的候选里随机，偶尔完全随机
      const random = rng(seed == null ? (Date.now() ^ 0x9e3779b9) : seed);
      const all = orderMoves(b, R.legalMoves(b, side));
      if (random() < 0.22) {
        pick = all[Math.floor(random() * all.length)];
      } else {
        pick = moves[Math.floor(random() * moves.length)]; // negamax 已并列收集最佳
      }
    } else {
      const random = rng(seed == null ? (Date.now() ^ 0x9e3779b9) : seed);
      pick = moves[Math.floor(random() * moves.length)];
    }
    return { move: pick, score, nodes: totalNodes, elapsed, aborted };
  }

  return { chooseMove, evaluate, MATE };
});
