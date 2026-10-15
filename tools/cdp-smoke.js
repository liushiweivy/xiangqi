/*
 * 鎏金象棋 - 独立 CDP headless 冒烟（不占用共享 Playwright 浏览器）
 * 运行: node tools/cdp-smoke.js
 * 覆盖: 菜单/双人走子/吃子特效截图/人机 AI 应着/悔棋/竞态/重复和棋/七型特效签名
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const PORT = 9237;
const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(os.tmpdir(), 'xiangqi-cdp-profile');
const URL = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');
const OUT = __dirname;

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

const CELL = 76, X0 = 56, Y0 = 52;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

async function waitCdp() {
  for (let i = 0; i < 60; i++) {
    try {
      await httpGet(`http://127.0.0.1:${PORT}/json/version`);
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error('CDP 启动超时');
}

let msgId = 0;
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pendings = new Map();
  const events = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pendings.has(m.id)) {
      pendings.get(m.id)(m.result);
      pendings.delete(m.id);
    } else if (m.method) {
      events.push(m);
    }
  };
  return new Promise((resolve) => {
    ws.onopen = () => {
      const send = (method, params) =>
        new Promise((res) => {
          const id = ++msgId;
          pendings.set(id, res);
          ws.send(JSON.stringify({ id, method, params: params || {} }));
        });
      resolve({
        send,
        events,
        close: () => ws.close(),
      });
    };
  });
}

async function evalJs(cdp, expr) {
  const r = await cdp.send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
  }
  return r.result.value;
}

async function shot(cdp, name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, 'base64'));
  console.log('  截图 ' + name);
}

// 点击棋盘交叉点（逻辑坐标）
async function tap(cdp, row, col) {
  const x = X0 + col * CELL;
  const y = Y0 + row * CELL;
  await evalJs(cdp, `(function(){
    var cv=document.getElementById('board');
    var rc=cv.getBoundingClientRect();
    var cx=rc.left+(${x}/720)*rc.width, cy=rc.top+(${y}/800)*rc.height;
    cv.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,clientX:cx,clientY:cy,pointerId:1}));
  })()`);
}

async function clickDom(cdp, id) {
  await evalJs(cdp, `document.getElementById(${JSON.stringify(id)}).click()`);
}

async function stateOf(cdp) {
  return evalJs(cdp, `({
    turn: document.getElementById('turn-text').textContent,
    moves: document.getElementById('movelist').children.length,
    trayR: document.getElementById('tray-r').children.length,
    trayB: document.getElementById('tray-b').children.length,
    menuShown: document.getElementById('menu').classList.contains('show'),
    overShown: document.getElementById('over').classList.contains('show'),
    overTitle: document.getElementById('over-title').textContent,
  })`);
}

async function main() {
  const exe = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
  if (!exe) throw new Error('未找到 Edge/Chrome');
  console.log('浏览器:', exe);

  const child = spawn(exe, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--window-size=1180,1000',
    URL,
  ], { detached: false, windowsHide: true });

  let failed = false;
  try {
    await waitCdp();
    const list = JSON.parse(await httpGet(`http://127.0.0.1:${PORT}/json/list`));
    const page = list.find((t) => t.type === 'page');
    const cdp = await connect(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await sleep(700);

    const errors = [];
    setInterval(() => {
      while (cdp.events.length) {
        const e = cdp.events.shift();
        if (e.method === 'Runtime.exceptionThrown') {
          errors.push('exception: ' + (e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text));
        } else if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
          errors.push('log: ' + e.params.entry.text);
        } else if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
          errors.push('console.error: ' + e.params.args.map((a) => a.value || a.description).join(' '));
        }
      }
    }, 100);

    // 1) 菜单
    let s = await stateOf(cdp);
    console.log('菜单状态:', JSON.stringify(s));
    if (!s.menuShown) throw new Error('菜单未显示');
    await shot(cdp, 'shot-01-menu.png');

    // 2) 双人：红兵前进一步 -> 黑卒前进一步 -> 黑卒吃红兵（触发吃子特效）
    await clickDom(cdp, 'start-pvp');
    await sleep(350);
    await tap(cdp, 6, 4);
    await sleep(80);
    await tap(cdp, 5, 4);
    await sleep(380);
    await tap(cdp, 3, 4);
    await sleep(80);
    await tap(cdp, 4, 4);
    await sleep(380);
    // 红兵在 (5,4)，黑卒在 (4,4)：红兵直进吃黑卒
    await tap(cdp, 5, 4);
    await sleep(120);
    await tap(cdp, 4, 4);
    await sleep(360); // 0.3s 落子动画结束时触发爆裂，抓扩散初期
    await shot(cdp, 'shot-02-capture-fx.png');
    await sleep(230);
    await shot(cdp, 'shot-02b-capture-fx-spread.png');
    await sleep(1070);
    await shot(cdp, 'shot-03-after-capture.png');
    s = await stateOf(cdp);
    console.log('吃子后:', JSON.stringify(s));
    if (s.moves !== 2) throw new Error('3 条历史应渲染 2 行棋谱，实际 ' + s.moves);
    if (s.trayR !== 1) throw new Error('红方缴获应有 1 子');
    if (s.turn !== '黑方行棋') throw new Error('吃完应轮到黑方');

    // 3) 悔棋
    await clickDom(cdp, 'btn-undo');
    await sleep(200);
    s = await stateOf(cdp);
    console.log('悔棋后:', JSON.stringify(s));
    if (s.trayR !== 0) throw new Error('悔棋后缴获应清空');

    // 4) 人机：执红，当头炮，等待 AI 应着
    await cdp.send('Page.reload');
    await sleep(700);
    await clickDom(cdp, 'start-r');
    await sleep(300);
    await tap(cdp, 7, 7);
    await sleep(80);
    await tap(cdp, 7, 4);
    await sleep(3000);
    await shot(cdp, 'shot-04-pve-ai-reply.png');
    s = await stateOf(cdp);
    console.log('人机状态:', JSON.stringify(s));
    if (s.moves !== 1 || s.turn !== '红方行棋') {
      throw new Error('AI 未正常应着: ' + JSON.stringify(s));
    }

    // 5) 竞态：人类走子后 120ms AI 定时器窗口内立刻重开，旧 AI 回调不得污染新局
    await clickDom(cdp, 'btn-restart');
    await sleep(250);
    await tap(cdp, 7, 7);
    await sleep(60);
    await tap(cdp, 7, 4);
    // 220ms 动画结束 -> 挂 120ms AI 定时器（340ms 触发），在窗口内重开
    await sleep(260);
    await clickDom(cdp, 'btn-restart');
    await sleep(1800);
    s = await stateOf(cdp);
    console.log('重开竞态后:', JSON.stringify(s));
    if (s.moves !== 0 || s.turn !== '红方行棋' || s.overShown) {
      throw new Error('旧局 AI 回调污染了新局: ' + JSON.stringify(s));
    }

    // 6) 执黑人机：悔掉 AI 首着后不得僵死（应重新调度 AI 再走一手）
    await clickDom(cdp, 'btn-menu');
    await sleep(200);
    await clickDom(cdp, 'start-b');
    await sleep(2500); // 红方 AI 行首着
    s = await stateOf(cdp);
    console.log('执黑开局:', JSON.stringify(s));
    if (s.moves !== 1 || s.turn !== '黑方行棋') throw new Error('执黑 AI 未正常开棋');
    await clickDom(cdp, 'btn-undo');
    await sleep(2500); // AI 重新行首着
    s = await stateOf(cdp);
    console.log('执黑悔棋后:', JSON.stringify(s));
    if (s.moves !== 1 || s.turn !== '黑方行棋' || s.overShown) {
      throw new Error('执黑悔掉 AI 首着后棋局僵死: ' + JSON.stringify(s));
    }
    await shot(cdp, 'shot-05-black-undo.png');

    // 7) 三次重复局面判和：双方各跳马再跳回，两轮后局面第三次等于初始
    await cdp.send('Page.reload');
    await sleep(700);
    await clickDom(cdp, 'start-pvp');
    await sleep(300);
    const cycle = [
      [9, 1, 7, 2], // 红 马八进七
      [0, 1, 2, 2], // 黑 马2进3
      [7, 2, 9, 1], // 红 马七退八
      [2, 2, 0, 1], // 黑 马3退2
    ];
    for (let round = 0; round < 2; round++) {
      for (const [fr, fc, tr, tc] of cycle) {
        await tap(cdp, fr, fc);
        await sleep(70);
        await tap(cdp, tr, tc);
        await sleep(340);
      }
    }
    await sleep(900); // gameDraw 浮层 700ms
    s = await stateOf(cdp);
    console.log('重复局面后:', JSON.stringify(s));
    if (!s.overShown || s.overTitle !== '和 棋') {
      throw new Error('三次重复局面未判和: ' + JSON.stringify(s));
    }
    await shot(cdp, 'shot-06-draw.png');

    // 8) 七型攻击子专属特效：覆盖画布上直接驱动真实 XQFX.Particles
    //    每型断言"签名粒子"，并各截一帧（约 130ms 扩散初期）
    await evalJs(cdp, `(function(){
      var cv=document.createElement('canvas');
      cv.width=760; cv.height=800;
      cv.style.cssText='position:fixed;left:50%;top:0;transform:translateX(-50%);z-index:99999;';
      document.body.appendChild(cv);
      var g=cv.getContext('2d');
      var sys=new window.XQFX.Particles();
      function frame(){
        g.setTransform(1,0,0,1,0,0);
        g.fillStyle='#1a110a'; g.fillRect(0,0,760,800);
        sys.update(0.016); sys.render(g);
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
      function sig(){
        var L=sys.list, cnt=function(k,extra){return L.filter(function(p){
          return p.kind===k&&(!extra||extra(p));}).length;};
        var f=L.filter(function(p){return p.kind==='floater';})[0];
        return {
          slash:cnt('slash'), arm:cnt('ring',function(p){return !!p.arcLen;}),
          smoke:cnt('smoke'), field:cnt('field'), leaf:cnt('leaf'),
          diamond:cnt('shard',function(p){return p.shape==='diamond';}),
          ray:cnt('ray'), spark:cnt('spark'),
          floater:f?f.text:null, royal:f?!!f.royal:false, total:L.length
        };
      }
      window.__fxStage={
        fire:function(type){
          sys.clear();
          var dir=type==='p'?{x:0,y:1}:{x:1,y:0};
          sys.burstCapture(380,400,type,'兵','b',dir);
          return sig();
        },
        royal:function(){
          sys.clear();
          sys.burstRoyal(380,400,'将','b');
          return sig();
        }
      };
    })()`);

    // 每型必须出现的签名粒子数
    const FX_EXPECT = {
      r: { slash: 2, spark: 80, floater: '斩' },       // 车：双月牙斩
      h: { arm: 2, smoke: 10, floater: '踏' },         // 马：双旋臂 + 扬尘
      c: { smoke: 18, spark: 105, floater: '轰' },     // 炮：浓烟烈火
      e: { field: 2, leaf: 18, floater: '裂' },        // 象：田印 + 翠羽
      a: { diamond: 12, ray: 8, floater: '挑' },       // 士：碎菱 + 斜路星芒
      p: { ray: 7, spark: 44, floater: '刺' },         // 兵：锥形疾刺
      k: { ray: 16, spark: 80, floater: '破' },        // 将：小王光束
    };
    for (const type of ['r', 'h', 'c', 'e', 'a', 'p', 'k']) {
      const sig = await evalJs(cdp, `window.__fxStage.fire(${JSON.stringify(type)})`);
      const want = FX_EXPECT[type];
      for (const [key, val] of Object.entries(want)) {
        const got = sig[key];
        const ok = typeof val === 'string' ? got === val : got >= val;
        if (!ok) throw new Error(`特效 ${type} 签名 ${key} 期望 ${val}，实际 ${got}`);
      }
      console.log('特效', type, JSON.stringify(sig));
      await sleep(130);
      await shot(cdp, `shot-07-fx-${type}.png`);
      await sleep(420); // 等粒子散尽再下一型
    }
    const rsig = await evalJs(cdp, `window.__fxStage.royal()`);
    if (rsig.ray !== 26 || rsig.royal !== true || rsig.floater !== '绝 杀') {
      throw new Error('皇家大招签名错误: ' + JSON.stringify(rsig));
    }
    console.log('特效 royal', JSON.stringify(rsig));
    await sleep(150);
    await shot(cdp, 'shot-07-fx-royal.png');
    await evalJs(cdp, `document.querySelectorAll('canvas').forEach(function(c){if(c.width===760)c.remove();})`);

    await sleep(500);
    console.log('\n页面错误:', errors.length ? '\n  ' + errors.join('\n  ') : '无');
    if (errors.length) failed = true;
    cdp.close();
  } catch (e) {
    console.error('冒烟失败:', e.message);
    failed = true;
  } finally {
    try {
      process.kill(child.pid);
    } catch {}
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  }
  process.exit(failed ? 1 : 0);
}

main();
