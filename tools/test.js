/*
 * 鎏金象棋 - Node 打桩测试：规则引擎 + AI
 * 运行: node tools/test.js
 */
const assert = require('assert');
const R = require('../js/rules.js');
const AI = require('../js/ai.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    console.error('  ✗ ' + name + '\n    ' + e.message);
    process.exitCode = 1;
  }
}

// 空棋盘 + 双将（默认错开列，避免照面干扰）
function emptyBoard() {
  const b = [];
  for (let r = 0; r < 10; r++) b.push(new Array(9).fill(null));
  b[0][4] = { t: 'k', side: 'b', id: 'bk' };
  b[9][3] = { t: 'k', side: 'r', id: 'rk' };
  return b;
}
function put(b, r, c, t, side) {
  b[r][c] = { t, side, id: t + r + c };
}
const has = (moves, tr, tc) => moves.some((m) => m.tr === tr && m.tc === tc);
const count = (moves) => moves.length;

console.log('\n[1] 开局');
test('开局双方各 44 个合法着法', () => {
  const b = R.createBoard();
  assert.strictEqual(count(R.legalMoves(b, 'r')), 44);
  assert.strictEqual(count(R.legalMoves(b, 'b')), 44);
});

test('初始 32 枚棋子就位', () => {
  const b = R.createBoard();
  let n = 0;
  for (const row of b) for (const p of row) if (p) n++;
  assert.strictEqual(n, 32);
});

console.log('\n[2] 各子走法');
test('车：纵横无阻，遇敌可吃不可越，遇友即停', () => {
  const b = emptyBoard();
  put(b, 6, 0, 'r', 'r');
  let ms = R.movesFrom(b, 'r', 6, 0);
  assert.ok(has(ms, 0, 0), '空线可直达');
  assert.ok(has(ms, 6, 8), '横向可直达');
  put(b, 3, 0, 'p', 'b');
  put(b, 6, 3, 'p', 'r');
  ms = R.movesFrom(b, 'r', 6, 0);
  assert.ok(has(ms, 3, 0), '可吃敌子');
  assert.ok(!has(ms, 2, 0), '吃后不可越过');
  assert.ok(!has(ms, 6, 3), '友子不可吃');
  assert.ok(has(ms, 6, 2), '友子前一格可走');
});

test('马：走日，蹩马腿', () => {
  const b = emptyBoard();
  put(b, 5, 4, 'h', 'r');
  let ms = R.movesFrom(b, 'r', 5, 4);
  assert.strictEqual(count(ms), 8);
  put(b, 4, 4, 'p', 'r'); // 正前方压马腿
  ms = R.movesFrom(b, 'r', 5, 4);
  assert.strictEqual(count(ms), 6);
  assert.ok(!has(ms, 3, 3));
  assert.ok(!has(ms, 3, 5));
  assert.ok(has(ms, 7, 3));
});

test('象：走田、塞象眼、不过河', () => {
  let b = emptyBoard();
  put(b, 0, 2, 'e', 'b');
  let ms = R.movesFrom(b, 'b', 0, 2);
  assert.strictEqual(count(ms), 2);
  assert.ok(has(ms, 2, 0) && has(ms, 2, 4));

  b = emptyBoard();
  put(b, 4, 2, 'e', 'b');
  ms = R.movesFrom(b, 'b', 4, 2);
  assert.ok(has(ms, 2, 0) && has(ms, 2, 4), '不过河着法存在');
  assert.ok(!has(ms, 6, 0) && !has(ms, 6, 4), '不可过河');
  // 只塞过河方向的两个眼，回头田仍可走
  put(b, 5, 1, 'p', 'b');
  put(b, 5, 3, 'p', 'b');
  ms = R.movesFrom(b, 'b', 4, 2);
  assert.ok(!has(ms, 6, 0) && !has(ms, 6, 4), '过河两眼被塞');
  assert.ok(has(ms, 2, 0) && has(ms, 2, 4), '回头田保留');
});

test('士：限九宫斜一步；将：限九宫直一步', () => {
  let b = emptyBoard();
  b[9][3] = { t: 'a', side: 'r', id: 'ra' }; // 仕占帅位
  put(b, 9, 5, 'k', 'r');                    // 帅移到 (9,5)
  let ms = R.movesFrom(b, 'r', 9, 3);
  assert.strictEqual(count(ms), 1);
  assert.ok(has(ms, 8, 4));

  b = emptyBoard(); // 帅在 (9,3)：上 (8,3) 可走；右 (9,4) 与黑将同列照面，被禁
  ms = R.movesFrom(b, 'r', 9, 3);
  assert.strictEqual(count(ms), 1);
  assert.ok(has(ms, 8, 3));
  assert.ok(!has(ms, 9, 4), '移入照面列非法');
});

test('炮：不吃走空线，吃子隔恰好一个炮架', () => {
  let b = emptyBoard();
  put(b, 5, 2, 'c', 'b');
  put(b, 3, 2, 'p', 'b'); // 炮架（避开 c4，勿使红车照将黑将）
  put(b, 1, 2, 'r', 'r'); // 目标
  let ms = R.movesFrom(b, 'b', 5, 2);
  assert.ok(has(ms, 1, 2), '隔一山可打');
  assert.ok(!has(ms, 0, 2), '打后不可越');
  assert.ok(has(ms, 4, 2), '架前空位可走');
  assert.ok(!has(ms, 2, 2), '架与目标之间不可落子');

  put(b, 4, 2, 'p', 'b'); // 第二个架
  ms = R.movesFrom(b, 'b', 5, 2);
  assert.ok(!has(ms, 1, 2), '双架不可打');
});

test('兵卒：未过河只进，过河可横行，不后退', () => {
  let b = emptyBoard();
  put(b, 4, 0, 'p', 'b');
  let ms = R.movesFrom(b, 'b', 4, 0);
  assert.strictEqual(count(ms), 1);
  assert.ok(has(ms, 5, 0));

  b = emptyBoard();
  put(b, 5, 0, 'p', 'b'); // 已过河
  ms = R.movesFrom(b, 'b', 5, 0);
  assert.ok(has(ms, 6, 0) && has(ms, 5, 1), '过河可进可横');
  assert.ok(!has(ms, 4, 0), '不可退');

  b = emptyBoard();
  put(b, 6, 8, 'p', 'r');
  ms = R.movesFrom(b, 'r', 6, 8);
  assert.strictEqual(count(ms), 1, '红兵未过河只进');
});

console.log('\n[3] 将帅规则');
test('白脸将：同列无子照面即将军', () => {
  const b = emptyBoard(); // 默认错开列，不照面
  assert.strictEqual(R.isInCheck(b, 'r'), false);
  b[9][3] = null;
  put(b, 9, 4, 'k', 'r'); // 红帅移到 c4，与黑将同列，中间全空
  assert.strictEqual(R.isInCheck(b, 'r'), true);
  assert.strictEqual(R.isInCheck(b, 'b'), true);
  put(b, 5, 4, 'r', 'r'); // 红车挡列
  assert.strictEqual(R.isInCheck(b, 'r'), false);
});

test('不能走完让己方被将军', () => {
  const b = R.createBoard();
  // 红帅初始被前排保护：任何开局着都合法（44 个已证）
  const ms = R.legalMoves(b, 'r');
  for (const m of ms) {
    const nb = R.applyMove(b, m);
    assert.strictEqual(R.isInCheck(nb, 'r'), false);
  }
});

test('车将军 + 将死判定（三车封宫）', () => {
  const b = emptyBoard();
  // 黑将压到宫底 (2,4)
  put(b, 2, 4, 'k', 'b');
  b[0][4] = null;
  put(b, 1, 4, 'r', 'r'); // 将脸将军
  put(b, 1, 3, 'r', 'r'); // 封左
  put(b, 1, 5, 'r', 'r'); // 封右
  assert.strictEqual(R.isInCheck(b, 'b'), true);
  assert.strictEqual(R.status(b, 'b'), 'checkmate');
  // 将脸车虽可吃，但吃后与红帅照面，故非法
  const ms = R.legalMoves(b, 'b');
  assert.strictEqual(ms.length, 0);
});

test('困毙（无着可走但未被将军）判负', () => {
  const b = emptyBoard();
  put(b, 2, 4, 'k', 'b');
  b[0][4] = null;
  put(b, 9, 3, 'k', 'r');
  b[9][4] = null;
  put(b, 1, 3, 'r', 'r');
  put(b, 1, 5, 'r', 'r');
  assert.strictEqual(R.isInCheck(b, 'b'), false);
  assert.strictEqual(R.status(b, 'b'), 'stalemate');
});

test('马将军带蹩腿判定', () => {
  const b = emptyBoard();
  put(b, 2, 3, 'h', 'r'); // 红马踩黑将 (0,4)：日字 (-2,+1)
  assert.strictEqual(R.isInCheck(b, 'b'), true);
  put(b, 1, 3, 'p', 'b'); // 压马腿 (1,3)
  assert.strictEqual(R.isInCheck(b, 'b'), false);
});

test('炮将军：中间恰好一个架子', () => {
  const b = emptyBoard();
  put(b, 9, 3, 'k', 'r');
  b[9][4] = null;
  put(b, 5, 4, 'c', 'r');
  put(b, 3, 4, 'p', 'b'); // 黑卒当架
  assert.strictEqual(R.isInCheck(b, 'b'), true);
  b[3][4] = null;
  assert.strictEqual(R.isInCheck(b, 'b'), false);
});

console.log('\n[4] 中文记谱');
test('炮二平五 / 马8进7 / 卒9进1 / 车九进二', () => {
  let b = R.createBoard();
  assert.strictEqual(R.notation(b, { fr: 7, fc: 7, tr: 7, tc: 4 }, 'r'), '炮二平五');
  assert.strictEqual(R.notation(b, { fr: 0, fc: 1, tr: 2, tc: 2 }, 'b'), '马2进3');
  assert.strictEqual(R.notation(b, { fr: 0, fc: 7, tr: 2, tc: 6 }, 'b'), '马8进7');
  assert.strictEqual(R.notation(b, { fr: 3, fc: 0, tr: 4, tc: 0 }, 'b'), '卒1进1');
  assert.strictEqual(R.notation(b, { fr: 9, fc: 0, tr: 7, tc: 0 }, 'r'), '车九进二');
  assert.strictEqual(R.notation(b, { fr: 6, fc: 4, tr: 5, tc: 4 }, 'r'), '兵五进一');
  assert.strictEqual(R.notation(b, { fr: 9, fc: 1, tr: 7, tc: 2 }, 'r'), '马八进七');
});

test('同列重车：前车 / 后车', () => {
  const b = emptyBoard();
  put(b, 0, 0, 'r', 'b');
  put(b, 5, 0, 'r', 'b');
  assert.strictEqual(R.notation(b, { fr: 5, fc: 0, tr: 5, tc: 3 }, 'b'), '前车平4');
  assert.strictEqual(R.notation(b, { fr: 0, fc: 0, tr: 0, tc: 3 }, 'b'), '后车平4');
});

test('同列三子：前/中/后记谱（红方小 r 为前）', () => {
  const b = emptyBoard();
  put(b, 4, 4, 'p', 'r');
  put(b, 5, 4, 'p', 'r');
  put(b, 6, 4, 'p', 'r');
  // 横走到 c3，红列号 CN_NUM[8-3] = 六
  assert.strictEqual(R.notation(b, { fr: 4, fc: 4, tr: 4, tc: 3 }, 'r'), '前兵平六');
  assert.strictEqual(R.notation(b, { fr: 5, fc: 4, tr: 5, tc: 3 }, 'r'), '中兵平六');
  assert.strictEqual(R.notation(b, { fr: 6, fc: 4, tr: 6, tc: 3 }, 'r'), '后兵平六');
});

console.log('\n[5] AI');
test('AI 走法必合法且同种子可复现', () => {
  const b0 = R.createBoard();
  const r1 = AI.chooseMove(b0, 'r', 2, 12345);
  const r2 = AI.chooseMove(b0, 'r', 2, 12345);
  assert.ok(r1.move, '应返回走法');
  const legal = R.legalMoves(b0, 'r');
  assert.ok(legal.some((m) => m.tr === r1.move.tr && m.tc === r1.move.tc));
  assert.deepStrictEqual(r1.move, r2.move);
});

test('AI 必吃白送的车', () => {
  const b = emptyBoard();
  put(b, 9, 3, 'k', 'r');
  b[9][4] = null;
  put(b, 4, 2, 'r', 'b');
  put(b, 5, 2, 'r', 'r');
  const res = AI.chooseMove(b, 'r', 2, 7);
  assert.strictEqual(res.move.tr, 4);
  assert.strictEqual(res.move.tc, 2);
});

test('AI 面对一步杀会选择杀着', () => {
  // 黑将 (0,4)；红车 (1,3)(1,5) 封两角，红车 (2,1) 平到 (2,4) 拔中即杀
  const b = emptyBoard();
  put(b, 1, 3, 'r', 'r');
  put(b, 1, 5, 'r', 'r');
  put(b, 2, 1, 'r', 'r');
  put(b, 3, 0, 'r', 'b'); // 给黑方一枚可动的车
  assert.strictEqual(R.isInCheck(b, 'b'), false, '当前黑将不应被将军');
  const res = AI.chooseMove(b, 'r', 3, 1);
  const nb = R.applyMove(b, res.move);
  assert.strictEqual(R.status(nb, 'b'), 'checkmate');
});

test('AI 自对弈 80 步不崩溃、不送将', () => {
  let b = R.createBoard();
  let side = 'r';
  for (let i = 0; i < 80; i++) {
    const res = AI.chooseMove(b, side, 1, 1000 + i);
    if (!res.move) break;
    b = R.applyMove(b, res.move);
    assert.strictEqual(R.isInCheck(b, side), false, `${side} 走完自己被将军`);
    const st = R.status(b, R.OTHER[side]);
    if (st === 'checkmate' || st === 'stalemate') break;
    side = R.OTHER[side];
  }
});

test('静止搜索：高手/大师开局不贪"炮打马"（首着不吃子）', () => {
  for (const level of [2, 3]) {
    const res = AI.chooseMove(R.createBoard(), 'r', level, 1);
    assert.strictEqual(res.move.cap, null, `level${level} 首着不应吃子`);
    assert.ok(res.score < 300, `level${level} 首着评估不应虚高: ${res.score}`);
  }
});

test('大师开局受墙钟预算约束（迭代加深 ~1.8s 上界）', () => {
  const b = R.createBoard();
  const res = AI.chooseMove(b, 'r', 3, 1);
  console.log(`    大师: ${res.nodes} 节点 ${res.elapsed}ms abort=${res.aborted}`);
  assert.ok(res.elapsed < 4000, '墙钟 1.8s 预算 + 余量，不应超过 4s');
  assert.ok(res.nodes > 1000);
  assert.ok(res.move, '即使超时也必须降级返回合法着法');
});

test('大师档自对弈前 6 手：迭代加深着着合法、耗时有界', () => {
  let b = R.createBoard();
  let side = 'r';
  for (let i = 0; i < 6; i++) {
    const res = AI.chooseMove(b, side, 3, 99 + i);
    assert.ok(res.move, '任何预算下都应有棋可走');
    const legal = R.legalMoves(b, side);
    assert.ok(legal.some((m) => m.tr === res.move.tr && m.tc === res.move.tc));
    b = R.applyMove(b, res.move);
    side = R.OTHER[side];
  }
});

console.log(`\n结果: ${passed} 项通过` + (process.exitCode ? '，存在失败 ✗\n' : '，全部通过 ✓\n'));
