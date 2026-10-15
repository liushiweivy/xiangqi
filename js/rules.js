/*
 * 鎏金象棋 - 规则引擎（纯逻辑，零依赖，UMD）
 * 棋盘: board[r][c]，r:0(黑方底线)..9(红方底线)，c:0..8
 * 棋子: { t:'k|a|e|h|r|c|p', side:'r'|'b', id:string }
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.XQRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ROWS = 10;
  const COLS = 9;
  const OTHER = { r: 'b', b: 'r' };
  // 各方行棋方向（前进时的行增量）
  const FORWARD = { r: -1, b: 1 };
  const VALUES = { k: 60000, r: 900, c: 450, h: 400, a: 200, e: 200, p: 100 };
  const NAMES = {
    r: { k: '帅', a: '仕', e: '相', h: '马', r: '车', c: '炮', p: '兵' },
    b: { k: '将', a: '士', e: '象', h: '马', r: '车', c: '炮', p: '卒' },
  };
  // 红方列号用汉字（红方从右数，c8 -> 一）；黑方用阿拉伯数字（c0 -> 1）
  const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

  function piece(t, side, id) {
    return { t, side, id };
  }

  function createBoard() {
    const b = [];
    for (let r = 0; r < ROWS; r++) b.push(new Array(COLS).fill(null));
    const back = ['r', 'h', 'e', 'a', 'k', 'a', 'e', 'h', 'r'];
    for (let c = 0; c < COLS; c++) {
      b[0][c] = piece(back[c], 'b', 'b' + back[c] + c);
      b[9][c] = piece(back[c], 'r', 'r' + back[c] + c);
    }
    b[2][1] = piece('c', 'b', 'bc1');
    b[2][7] = piece('c', 'b', 'bc2');
    b[7][1] = piece('c', 'r', 'rc1');
    b[7][7] = piece('c', 'r', 'rc2');
    for (const c of [0, 2, 4, 6, 8]) {
      b[3][c] = piece('p', 'b', 'bp' + c);
      b[6][c] = piece('p', 'r', 'rp' + c);
    }
    return b;
  }

  function cloneBoard(b) {
    const out = new Array(ROWS);
    for (let r = 0; r < ROWS; r++) out[r] = b[r].slice();
    return out;
  }

  const inBoard = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;

  function inPalace(side, r, c) {
    if (c < 3 || c > 5) return false;
    return side === 'b' ? r >= 0 && r <= 2 : r >= 7 && r <= 9;
  }

  // 兵是否已过河（以兵自身视角）
  function pawnCrossed(side, r) {
    return side === 'b' ? r >= 5 : r <= 4;
  }

  function findKing(b, side) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = b[r][c];
        if (p && p.t === 'k' && p.side === side) return { r, c };
      }
    }
    return null;
  }

  function pushMove(out, fr, fc, tr, tc, b) {
    const target = b[tr][tc];
    out.push({ fr, fc, tr, tc, cap: target ? target.t : null });
  }

  const HORSE_LEGS = [
    [2, 1, 1, 0], [2, -1, 1, 0], [-2, 1, -1, 0], [-2, -1, -1, 0],
    [1, 2, 0, 1], [-1, 2, 0, 1], [1, -2, 0, -1], [-1, -2, 0, -1],
  ];

  // 生成一方"伪合法"走法（不含送将/照面过滤）
  function genPseudo(b, side) {
    const out = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const p = b[r][c];
        if (!p || p.side !== side) continue;
        genPiece(b, r, c, p, out);
      }
    }
    return out;
  }

  function genPiece(b, r, c, p, out) {
    const side = p.side;
    const canLand = (tr, tc) => !b[tr][tc] || b[tr][tc].side !== side;
    switch (p.t) {
      case 'k': {
        const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (const [dr, dc] of dirs) {
          const tr = r + dr, tc = c + dc;
          if (inPalace(side, tr, tc) && canLand(tr, tc)) pushMove(out, r, c, tr, tc, b);
        }
        break;
      }
      case 'a': {
        const dirs = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
        for (const [dr, dc] of dirs) {
          const tr = r + dr, tc = c + dc;
          if (inPalace(side, tr, tc) && canLand(tr, tc)) pushMove(out, r, c, tr, tc, b);
        }
        break;
      }
      case 'e': {
        const dirs = [[2, 2], [2, -2], [-2, 2], [-2, -2]];
        for (const [dr, dc] of dirs) {
          const tr = r + dr, tc = c + dc;
          if (!inBoard(tr, tc)) continue;
          // 象不过河
          if (side === 'b' && tr > 4) continue;
          if (side === 'r' && tr < 5) continue;
          if (b[r + dr / 2][c + dc / 2]) continue; // 塞象眼
          if (canLand(tr, tc)) pushMove(out, r, c, tr, tc, b);
        }
        break;
      }
      case 'h': {
        for (const [dr, dc, lr, lc] of HORSE_LEGS) {
          const tr = r + dr, tc = c + dc;
          if (!inBoard(tr, tc)) continue;
          if (b[r + lr][c + lc]) continue; // 蹩马腿
          if (canLand(tr, tc)) pushMove(out, r, c, tr, tc, b);
        }
        break;
      }
      case 'r': {
        ray(b, r, c, side, out, false);
        break;
      }
      case 'c': {
        ray(b, r, c, side, out, true);
        break;
      }
      case 'p': {
        const f = FORWARD[side];
        const fronts = [[f, 0]];
        if (pawnCrossed(side, r)) fronts.push([0, 1], [0, -1]);
        for (const [dr, dc] of fronts) {
          const tr = r + dr, tc = c + dc;
          if (inBoard(tr, tc) && canLand(tr, tc)) pushMove(out, r, c, tr, tc, b);
        }
        break;
      }
    }
  }

  // 车/炮共用的射线扫描
  function ray(b, r, c, side, out, isCannon) {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dr, dc] of dirs) {
      let tr = r + dr, tc = c + dc;
      let screened = false;
      while (inBoard(tr, tc)) {
        const q = b[tr][tc];
        if (!isCannon) {
          if (!q) {
            pushMove(out, r, c, tr, tc, b);
          } else {
            if (q.side !== side) pushMove(out, r, c, tr, tc, b);
            break;
          }
        } else {
          if (!screened) {
            if (!q) pushMove(out, r, c, tr, tc, b); // 炮走空
            else screened = true; // 炮架
          } else if (q) {
            if (q.side !== side) pushMove(out, r, c, tr, tc, b); // 隔山打牛
            break;
          }
        }
        tr += dr;
        tc += dc;
      }
    }
  }

  // 判断 side 方将/帅是否正被将军（含白脸将照面）
  function isInCheck(b, side) {
    const k = findKing(b, side);
    if (!k) return true;
    const o = OTHER[side];
    const { r: kr, c: kc } = k;

    // 1) 直线：车、照面将；扫描中识别炮
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dr, dc] of dirs) {
      let tr = kr + dr, tc = kc + dc;
      let screened = false;
      while (inBoard(tr, tc)) {
        const q = b[tr][tc];
        if (q) {
          if (!screened) {
            if (q.side === o && (q.t === 'r' || (q.t === 'k' && dc === 0))) return true;
            screened = true; // 首个子（不分敌我）成为炮架
          } else {
            if (q.side === o && q.t === 'c') return true;
            break; // 炮架后任何子都阻断射线
          }
        }
        tr += dr;
        tc += dc;
      }
    }

    // 2) 马（含蹩腿判定，腿点在马一侧）
    for (const [dr, dc, lr, lc] of HORSE_LEGS) {
      const mr = kr - dr, mc = kc - dc;
      if (!inBoard(mr, mc)) continue;
      const q = b[mr][mc];
      if (q && q.side === o && q.t === 'h') {
        if (!b[mr + lr] || !b[mr + lr][mc + lc]) return true;
      }
    }

    // 3) 兵/卒
    const of = FORWARD[o];
    const front = b[kr - of] && b[kr - of][kc];
    if (front && front.side === o && front.t === 'p') return true;
    for (const dc of [-1, 1]) {
      const q = b[kr] && b[kr][kc + dc];
      // 横吃要求该兵已经过河
      if (q && q.side === o && q.t === 'p' && pawnCrossed(o, kr)) return true;
    }

    // 4) 士（斜一步，必在对方九宫内）
    for (const [dr, dc] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const tr = kr + dr, tc = kc + dc;
      if (!inBoard(tr, tc)) continue;
      const q = b[tr][tc];
      if (q && q.side === o && q.t === 'a' && inPalace(o, tr, tc)) return true;
    }

    return false;
  }

  function applyMove(b, m) {
    const nb = cloneBoard(b);
    nb[m.tr][m.tc] = nb[m.fr][m.fc];
    nb[m.fr][m.fc] = null;
    return nb;
  }

  // 全部合法走法（过滤走完己方被将军）
  function legalMoves(b, side) {
    const pseudo = genPseudo(b, side);
    const out = [];
    for (const m of pseudo) {
      const nb = applyMove(b, m);
      if (!isInCheck(nb, side)) out.push(m);
    }
    return out;
  }

  function movesFrom(b, side, r, c) {
    return legalMoves(b, side).filter((m) => m.fr === r && m.fc === c);
  }

  function hasLegalMove(b, side) {
    const pseudo = genPseudo(b, side);
    for (const m of pseudo) {
      const nb = applyMove(b, m);
      if (!isInCheck(nb, side)) return true;
    }
    return false;
  }

  // 'playing' | 'check' | 'checkmate' | 'stalemate'
  function status(b, side) {
    const checked = isInCheck(b, side);
    const alive = hasLegalMove(b, side);
    if (!alive) return checked ? 'checkmate' : 'stalemate';
    return checked ? 'check' : 'playing';
  }

  // ---------- 中文记谱（传统象棋记谱法） ----------
  function lineNum(col, side) {
    return side === 'r' ? CN_NUM[COLS - 1 - col] : String(col + 1);
  }
  function stepNum(n, side) {
    return side === 'r' ? CN_NUM[n - 1] : String(n);
  }

  function notation(b, m, side) {
    const p = b[m.fr][m.fc];
    if (!p) return '';
    const t = p.t;
    // 同列同型重子：前/后 + 子名
    const twins = [];
    for (let r = 0; r < ROWS; r++) {
      const q = b[r][m.fc];
      if (q && q.side === side && q.t === t) twins.push(r);
    }
    let head;
    if (twins.length >= 2) {
      // 按推进程度排序：r * FORWARD 越大越靠前（红方向 -1，故小 r 为前）
      const ordered = twins.slice().sort((x, y) => y * FORWARD[side] - x * FORWARD[side]);
      const prefix = ordered.length === 2
        ? (m.fr === ordered[0] ? '前' : '后')
        : ['前', '中', '后'][ordered.indexOf(m.fr)] || '前';
      head = prefix + NAMES[side][t];
    } else {
      head = NAMES[side][t] + lineNum(m.fc, side);
    }

    const dr = m.tr - m.fr;
    let action, tail;
    if (dr === 0) {
      action = '平';
      tail = lineNum(m.tc, side);
    } else {
      const forward = dr * FORWARD[side] > 0;
      action = forward ? '进' : '退';
      if (t === 'h' || t === 'a' || t === 'e') {
        tail = lineNum(m.tc, side); // 斜走子记目标列
      } else {
        tail = stepNum(Math.abs(dr), side);
      }
    }
    return head + action + tail;
  }

  return {
    ROWS, COLS, OTHER, FORWARD, VALUES, NAMES, CN_NUM,
    createBoard, cloneBoard, inBoard, inPalace, pawnCrossed, findKing,
    genPseudo, genPiece, legalMoves, movesFrom, hasLegalMove,
    applyMove, isInCheck, status, notation,
  };
});
