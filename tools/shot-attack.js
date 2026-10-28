/*
 * 鎏金象棋 - 四子型攻击演出相位确定性截图（车闪/马踏/炮轰/兵刺）
 * 用 __xqFreeze + __xqScrubCapture(kind,q,fxAge) 摆阵拖帧
 * 运行: node tools/shot-attack.js
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const PORT = 9238;
const ROOT = path.join(__dirname, '..');
const PROFILE = path.join(os.tmpdir(), 'xiangqi-shot-profile');
const URL = 'file:///' + path.join(ROOT, 'index.html').replace(/\\/g, '/');

const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];
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

let msgId = 0;
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pendings = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pendings.has(m.id)) {
      pendings.get(m.id)(m.result);
      pendings.delete(m.id);
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
      resolve({ send, close: () => ws.close() });
    };
  });
}

async function evalJs(cdp, expr) {
  const r = await cdp.send('Runtime.evaluate', {
    expression: expr, awaitPromise: true, returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
}

async function shot(cdp, name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(__dirname, name), Buffer.from(r.data, 'base64'));
  console.log('截图', name);
}

async function setup(cdp) {
  await cdp.send('Page.reload');
  await sleep(650);
  await evalJs(cdp, `document.getElementById('start-pvp').click()`);
  await sleep(300);
  await evalJs(cdp, `window.__xqFreeze = true`);
}

async function phase(cdp, kind, q, fxAge, name) {
  await setup(cdp);
  const dbg = await evalJs(cdp, `window.__xqScrubCapture(${JSON.stringify(kind)}, ${q}, ${fxAge || 0})`);
  console.log(name, JSON.stringify(dbg));
  if (dbg.error) throw new Error('拖帧失败: ' + JSON.stringify(dbg));
  await shot(cdp, name);
}

async function main() {
  const exe = EDGE_CANDIDATES.find((p) => fs.existsSync(p));
  const child = spawn(exe, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    '--window-size=1180,1000', URL,
  ], { detached: false, windowsHide: true });

  let failed = false;
  try {
    for (let i = 0; i < 60; i++) {
      try { await httpGet(`http://127.0.0.1:${PORT}/json/version`); break; }
      catch { await sleep(250); }
    }
    const list = JSON.parse(await httpGet(`http://127.0.0.1:${PORT}/json/list`));
    const cdp = await connect(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await sleep(500);

    // 车 r：dur .42 / wind .07 / dash .36；马 h：.56 / .14 / .6
    // 炮 c：.62 / .24 / .7；兵 p：.46 / .14 / .48
    await phase(cdp, 'r', 0.2, 0, 'shot-atk-r-1dash.png');
    await phase(cdp, 'r', 0.36, 0, 'shot-atk-r-2hit.png');
    await phase(cdp, 'h', 0.38, 0, 'shot-atk-h-1leap.png');
    await phase(cdp, 'h', 0.6, 0, 'shot-atk-h-2hit.png');
    await phase(cdp, 'c', 0.38, 0, 'shot-atk-c-1shell.png');
    await phase(cdp, 'c', 0.7, 0, 'shot-atk-c-2hit.png');
    await phase(cdp, 'c', 0.86, 0.2, 'shot-atk-c-3land.png');
    await phase(cdp, 'p', 0.34, 0, 'shot-atk-p-1spear.png');
    await phase(cdp, 'p', 0.48, 0.3, 'shot-atk-p-2burst.png');
    cdp.close();
  } catch (e) {
    console.error('失败:', e.message);
    failed = true;
  } finally {
    try { process.kill(child.pid); } catch {}
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  }
  process.exit(failed ? 1 : 0);
}

main();
