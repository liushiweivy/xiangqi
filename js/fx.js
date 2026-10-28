/*
 * 鎏金象棋 - 特效与音效（零依赖）
 * 粒子系统: 火花/碎片/硝烟/汉字飞散/冲击波/剑气/光束/金龙/浮字/田印/翠羽/碎菱
 * 吃子特效按攻击子七型分发（车/马/炮/象相/士仕/兵卒/将帅 各一套，终局 burstRoyal 独立）
 * 音效: WebAudio 全合成（落子/七型吃子/将军/胜负）
 */
(function (global) {
  'use strict';

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (pal) => pal[Math.floor(Math.random() * pal.length)];
  const WARM = ['#fff3c4', '#ffd24d', '#ff9a30', '#ff4d20'];
  const COLD = ['#eaf6ff', '#8fd8ff', '#3f9bff', '#7b5cff'];
  const FIRE = ['#fff7c0', '#ffd24d', '#ff7a18', '#e82d12'];
  const DUST = ['#fff0c0', '#e8b860', '#a8743a'];   // 马：尘金
  const JADE = ['#f6ffe8', '#bfe8c0', '#5cc488', '#2b9a68']; // 象：翠玉
  const STAR = ['#ffffff', '#ffeec0', '#ffd270'];   // 士：星金
  const SPIKE = ['#fff6e0', '#ffd870', '#ff6a3a'];  // 兵：刺芒

  // 各攻击子吃子参数（特效由攻击子主导，碎片/汉字沿用被吃子）
  const CAPTURE_CONF = {
    r: { pal: WARM, shake: 12, flash: 190, rings: 2, word: '斩', tint: 'gold' },
    h: { pal: DUST, shake: 10, flash: 170, rings: 0, word: '踏', tint: 'gold' },
    c: { pal: FIRE, shake: 15, flash: 220, rings: 3, word: '轰', tint: 'fire' },
    e: { pal: JADE, shake: 8, flash: 160, rings: 1, word: '裂', tint: 'jade' },
    a: { pal: STAR, shake: 7, flash: 150, rings: 1, word: '挑', tint: 'star' },
    p: { pal: SPIKE, shake: 6, flash: 140, rings: 1, word: '刺', tint: 'fire' },
    k: { pal: WARM, shake: 20, flash: 260, rings: 3, word: '破', tint: 'fire' },
  };

  class Particles {
    constructor() {
      this.list = [];
      this.shakeMag = 0;
      this.shakeX = 0;
      this.shakeY = 0;
      this.flash = null; // {x,y,t,max,r,color}
    }

    add(p) {
      p.t = 0;
      p.delay = p.delay || 0;
      this.list.push(p);
      return p;
    }

    addShake(v) {
      this.shakeMag = Math.min(30, this.shakeMag + v);
    }

    burstMove(x, y, side) {
      const pal = side === 'r' ? ['#ffe9a8', '#ffc94d'] : ['#d9ecff', '#6fb8ff'];
      this.flash = { x, y, t: 0, max: 0.22, r: 52, color: pal[1] };
      this.ring(x, y, 8, 46, 0.32, pal[1], 3);
      for (let i = 0; i < 12; i++) {
        const a = rand(0, TAU);
        this.add({
          kind: 'spark', x, y, vx: Math.cos(a) * rand(40, 130), vy: Math.sin(a) * rand(40, 130),
          life: rand(0.18, 0.34), size: rand(1, 2.2), color: pal[i % 2], drag: 4, grav: 60,
        });
      }
      this.addShake(2.2);
    }

    // 吃子：特效由攻击子主导（dir 为攻击方向屏幕向量，兵的锥形疾刺用）
    burstCapture(x, y, atkType, victimName, victimSide, dir) {
      const cfg = CAPTURE_CONF[atkType] || CAPTURE_CONF.p;
      this.lastBurstX = x;
      this.lastBurstY = y;
      this.flash = { x, y, t: 0, max: 0.34, r: cfg.flash, color: '#fff6d8' };
      this.addShake(cfg.shake);
      for (let i = 0; i < cfg.rings; i++) this._shockRing(x, y, i, cfg.pal);
      switch (atkType) {
        case 'r': this._fxRook(x, y, cfg.pal); break;
        case 'h': this._fxHorse(x, y, cfg.pal); break;
        case 'c': this._fxCannon(x, y, cfg.pal); break;
        case 'e': this._fxElephant(x, y, cfg.pal); break;
        case 'a': this._fxAdvisor(x, y, cfg.pal); break;
        case 'k': this._fxKing(x, y, cfg.pal); break;
        default: this._fxPawn(x, y, cfg.pal, dir);
      }
      this._debris(x, y, victimName, victimSide);
      this._word(x, y, cfg.word, cfg.tint, false);
    }

    // 终局吃将：金龙大招（26 光束 + 升龙 + 绝杀浮印）
    burstRoyal(x, y, victimName, victimSide) {
      this.lastBurstX = x;
      this.lastBurstY = y;
      this.flash = { x, y, t: 0, max: 0.7, r: 340, color: '#fff6d8' };
      this.addShake(24);
      for (let i = 0; i < 4; i++) {
        this.add({
          kind: 'ring', x, y, t: 0, life: 0.5 + i * 0.12, delay: i * 0.07,
          r0: 10 + i * 6, r1: 300 - i * 36,
          color: i % 2 ? WARM[1] : '#fff3c4', width: 7 - i,
        });
      }
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * TAU + rand(-0.05, 0.05);
        this.add({
          kind: 'ray', x, y, t: 0, life: rand(0.5, 0.8), delay: rand(0, 0.12),
          angle: a, len0: rand(20, 60), len1: rand(220, 330), width: rand(2, 5),
          color: i % 3 === 0 ? '#fff3c4' : WARM[1],
        });
      }
      for (let i = 0; i < 120; i++) {
        const a = rand(0, TAU), sp = rand(90, 460);
        const p = {
          kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: rand(0.3, 0.95), size: rand(1.4, 4), color: pick(WARM),
          drag: rand(1.4, 2.6), grav: 50, dragon: Math.random() < 0.38,
        };
        if (p.dragon) {
          p.vy = -rand(160, 320);
          p.vx = rand(-40, 40);
          p.life = rand(0.9, 1.5);
          p.grav = -60;
          p.size = rand(2, 4.2);
          p.seed = rand(0, TAU);
        }
        this.add(p);
      }
      this._smoke(x, y, 18, 64, true);
      this._debris(x, y, victimName, victimSide);
      this._word(x, y, '绝 杀', 'fire', true);
    }

    _shockRing(x, y, i, pal) {
      this.add({
        kind: 'ring', x, y, t: 0, life: 0.5 + i * 0.12, delay: i * 0.07,
        r0: 10 + i * 6, r1: 170 - i * 24,
        color: i % 2 ? pal[1] : '#fff3c4', width: 4,
      });
    }

    _smoke(x, y, n, r1max, dark) {
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU);
        const dist = rand(0, 20);
        this.add({
          kind: 'smoke', x: x + Math.cos(a) * dist, y: y + Math.sin(a) * dist,
          vx: Math.cos(a) * rand(10, 60), vy: Math.sin(a) * rand(10, 60) - 30,
          t: 0, life: rand(0.5, 1.0), r0: rand(6, 14), r1: rand(r1max * 0.55, r1max),
          shade: dark ? rand(18, 40) : rand(36, 60),
        });
      }
    }

    // 车：横向剑气 + 双月牙斩
    _fxRook(x, y, pal) {
      for (let i = 0; i < 2; i++) {
        this.add({
          kind: 'slash', x, y, t: 0, life: 0.34, delay: i * 0.09,
          dir: i === 0 ? 1 : -1, span: 1.5, grow: 110,
        });
      }
      for (let i = 0; i < 80; i++) {
        const d = Math.random() < 0.5 ? -1 : 1;
        this.add({
          kind: 'spark', x, y, vx: d * rand(260, 520), vy: rand(-90, 90),
          life: rand(0.25, 0.5), size: rand(1.6, 3), color: pick(pal),
          drag: rand(1.4, 2.6), grav: 130,
        });
      }
      this._smoke(x, y, 6, 40, false);
    }

    // 马：切向旋风 + 两道旋臂 + 扬尘
    _fxHorse(x, y, pal) {
      for (let i = 0; i < 2; i++) {
        this.add({
          kind: 'ring', x, y, t: 0, life: 0.45, delay: i * 0.06,
          r0: 14, r1: 96, color: pal[1], width: 5,
          arcStart: rand(0, TAU), arcLen: 1.7, spin: (i === 0 ? 1 : -1) * 3.2,
        });
      }
      for (let i = 0; i < 64; i++) {
        const a = rand(0, TAU);
        const sp = rand(120, 380);
        const tan = a + Math.PI / 2;
        this.add({
          kind: 'spark', x, y,
          vx: Math.cos(tan) * sp * 0.9 + Math.cos(a) * 30,
          vy: Math.sin(tan) * sp * 0.9 + Math.sin(a) * 30 - 40,
          life: rand(0.4, 0.75), size: rand(1.4, 2.8), color: pick(pal),
          drag: 2.2, grav: 90, swirl: rand(5, 9) * (Math.random() < 0.5 ? 1 : -1),
        });
      }
      this._smoke(x, y, 10, 52, false);
    }

    // 炮：全向烈焰爆 + 浓硝烟
    _fxCannon(x, y, pal) {
      for (let i = 0; i < 105; i++) {
        const a = rand(0, TAU);
        const sp = rand(90, 420);
        this.add({
          kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: rand(0.3, 0.7), size: rand(1.6, 3.4), color: pick(pal),
          drag: rand(1.4, 2.4), grav: 140,
        });
      }
      this._smoke(x, y, 18, 64, true);
    }

    // 象：翠玉"田"字双印 + 翠羽飞散（象走田）
    _fxElephant(x, y, pal) {
      this.add({ kind: 'field', x, y, t: 0, life: 0.55, r0: 12, r1: 108, color: pal[2], rotated: false });
      this.add({ kind: 'field', x, y, t: 0, life: 0.55, delay: 0.05, r0: 8, r1: 86, color: pal[1], rotated: true });
      for (let i = 0; i < 18; i++) {
        const a = rand(0, TAU);
        const sp = rand(60, 230);
        this.add({
          kind: 'leaf', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
          life: rand(0.6, 1.1), size: rand(6, 12), rot: rand(0, TAU),
          vr: rand(-5, 5), color: pick(pal), seed: rand(0, TAU),
        });
      }
      for (let i = 0; i < 30; i++) {
        const a = rand(0, TAU);
        const sp = rand(60, 240);
        this.add({
          kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: rand(0.3, 0.6), size: rand(1.2, 2.4), color: pick(pal),
          drag: 2.4, grav: 60,
        });
      }
    }

    // 士：斜路星芒（士走两斜线）+ 碎菱金盾
    _fxAdvisor(x, y, pal) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU + Math.PI / 4;
        const long = i % 2 === 0;
        this.add({
          kind: 'ray', x, y, t: 0, life: long ? rand(0.4, 0.6) : rand(0.25, 0.4),
          angle: a, len0: 16, len1: long ? rand(180, 240) : rand(80, 120),
          width: long ? rand(3, 5) : rand(1.6, 2.6), color: pick(pal),
        });
      }
      for (let i = 0; i < 44; i++) {
        const a = Math.PI / 4 + Math.floor(rand(0, 4)) * (Math.PI / 2) + rand(-0.12, 0.12);
        const sp = rand(140, 420);
        this.add({
          kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: rand(0.25, 0.5), size: rand(1.2, 2.4), color: pick(pal),
          drag: 2.4, grav: 40, streak: 2.4,
        });
      }
      for (let i = 0; i < 12; i++) {
        const a = rand(0, TAU);
        const sp = rand(90, 280);
        this.add({
          kind: 'shard', shape: 'diamond', x, y,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
          life: rand(0.5, 0.9), size: rand(3, 7), rot: rand(0, TAU),
          vr: rand(-9, 9), color: '#ecc874', grav: 420,
        });
      }
    }

    // 兵/卒：沿攻击方向的锥形疾刺
    _fxPawn(x, y, pal, dir) {
      const hasDir = dir && (dir.x || dir.y);
      const base = Math.atan2(hasDir ? dir.y : -1, hasDir ? dir.x : 0);
      for (let i = 0; i < 7; i++) {
        this.add({
          kind: 'ray', x, y, t: 0, life: rand(0.18, 0.32),
          angle: base + rand(-0.5, 0.5), len0: 10, len1: rand(90, 170),
          width: rand(2, 3.6), color: pick(pal),
        });
      }
      for (let i = 0; i < 44; i++) {
        const a = base + rand(-0.55, 0.55);
        const sp = rand(180, 460);
        this.add({
          kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: rand(0.18, 0.4), size: rand(1.4, 2.8), color: pick(pal),
          drag: 2.6, grav: 60,
        });
      }
      this._smoke(x, y, 4, 30, false);
    }

    // 将/帅吃子（罕见）：小型王者光束
    _fxKing(x, y, pal) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU + rand(-0.06, 0.06);
        this.add({
          kind: 'ray', x, y, t: 0, life: rand(0.4, 0.7), delay: rand(0, 0.1),
          angle: a, len0: 20, len1: rand(180, 280), width: rand(2.4, 4.4),
          color: i % 3 === 0 ? '#fff3c4' : pick(pal),
        });
      }
      for (let i = 0; i < 80; i++) {
        const a = rand(0, TAU);
        const sp = rand(90, 400);
        const p = {
          kind: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
          life: rand(0.3, 0.85), size: rand(1.4, 3.4), color: pick(pal),
          drag: rand(1.4, 2.6), grav: 80, dragon: Math.random() < 0.12,
        };
        if (p.dragon) {
          p.vy = -rand(150, 280);
          p.vx = rand(-36, 36);
          p.life = rand(0.8, 1.2);
          p.grav = -50;
          p.seed = rand(0, TAU);
        }
        this.add(p);
      }
    }

    // 被吃子残骸：棋子碎片（被吃方棋色）+ 汉字飞散
    _debris(x, y, victimName, victimSide) {
      const pieceColor = victimSide === 'r' ? '#e8c98f' : '#2a2520';
      for (let i = 0; i < 16; i++) {
        const a = rand(0, TAU);
        const sp = rand(80, 300);
        this.add({
          kind: 'shard', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
          life: rand(0.5, 0.95), size: rand(3, 9), rot: rand(0, TAU),
          vr: rand(-9, 9), color: pieceColor, grav: 520,
        });
      }
      for (let i = 0; i < 8; i++) {
        const a = rand(0, TAU);
        const sp = rand(60, 240);
        this.add({
          kind: 'glyph', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 120,
          life: rand(0.6, 1.1), size: rand(16, 30), rot: rand(-0.6, 0.6),
          vr: rand(-3, 3), text: victimName,
          color: victimSide === 'r' ? '#d8472b' : '#e8d9a8', grav: 380,
        });
      }
    }

    _word(x, y, text, tint, royal) {
      this.add({
        kind: 'floater', x, y, vx: 0, vy: royal ? -34 : -46,
        life: royal ? 1.6 : 0.95, text, size: royal ? 64 : 44,
        royal, tint: tint || 'gold',
      });
    }

    ring(x, y, r0, r1, life, color, width) {
      this.add({ kind: 'ring', x, y, t: 0, life, r0, r1, color, width: width || 4 });
    }

    update(dt) {
      const all = this.list;
      for (let i = all.length - 1; i >= 0; i--) {
        const p = all[i];
        if (p.delay > 0) {
          p.delay -= dt;
          continue;
        }
        p.t += dt;
        if (p.t >= p.life) {
          all.splice(i, 1);
          continue;
        }
        const k = p.kind;
        if (k === 'spark') {
          if (p.swirl) {
            const dx = p.x - this.lastBurstX, dy = p.y - this.lastBurstY;
            const d = Math.hypot(dx, dy) || 1;
            p.vx += (-dy / d) * p.swirl * 260 * dt;
            p.vy += (dx / d) * p.swirl * 260 * dt;
          }
          if (p.dragon) p.vx += Math.sin(p.t * 9 + p.seed) * 360 * dt;
          p.vx -= p.vx * p.drag * dt;
          p.vy -= p.vy * p.drag * dt;
          p.vy += p.grav * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
        } else if (k === 'shard' || k === 'glyph') {
          p.vy += p.grav * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.rot += p.vr * dt;
          if (k === 'glyph') p.vx *= 1 - 1.6 * dt;
        } else if (k === 'leaf') {
          // 翠羽：轻重力 + 横向飘舞
          p.vy += 110 * dt;
          p.vx += Math.sin(p.t * 7 + p.seed) * 150 * dt;
          p.vx *= 1 - 1.2 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.rot += p.vr * dt;
        } else if (k === 'ring' && p.spin) {
          p.arcStart += p.spin * dt;
        } else if (k === 'smoke') {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
        } else if (k === 'floater') {
          p.y += p.vy * dt;
        }
      }
      if (this.flash) {
        this.flash.t += dt;
        if (this.flash.t >= this.flash.max) this.flash = null;
      }
      // 震屏衰减
      this.shakeMag *= Math.exp(-7.5 * dt);
      if (this.shakeMag < 0.15) this.shakeMag = 0;
      this.shakeX = this.shakeMag ? rand(-this.shakeMag, this.shakeMag) : 0;
      this.shakeY = this.shakeMag ? rand(-this.shakeMag, this.shakeMag) : 0;
    }

    render(ctx) {
      // 硝烟（普通混合，最底层）
      for (const p of this.list) {
        if (p.kind !== 'smoke' || p.delay > 0) continue;
        const q = p.t / p.life;
        const r = p.r0 + (p.r1 - p.r0) * q;
        const a = 0.34 * (1 - q);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, `rgba(${p.shade},${p.shade},${p.shade},${a})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, TAU);
        ctx.fill();
      }

      // 碎片 + 汉字
      for (const p of this.list) {
        if (p.delay > 0) continue;
        const q = p.t / p.life;
        if (p.kind === 'shard') {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.globalAlpha = q < 0.7 ? 1 : 1 - (q - 0.7) / 0.3;
          ctx.fillStyle = p.color;
          ctx.strokeStyle = 'rgba(0,0,0,.45)';
          ctx.lineWidth = 1;
          const s = p.size;
          ctx.beginPath();
          if (p.shape === 'diamond') {
            // 士：碎菱
            ctx.moveTo(0, -s);
            ctx.lineTo(s * 0.7, 0);
            ctx.lineTo(0, s);
            ctx.lineTo(-s * 0.7, 0);
          } else {
            ctx.moveTo(0, -s);
            ctx.lineTo(s * 0.8, s * 0.5);
            ctx.lineTo(-s * 0.6, s * 0.7);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        } else if (p.kind === 'leaf') {
          // 象：翠羽（梭形叶片 + 中脉）
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.globalAlpha = q < 0.65 ? 1 : 1 - (q - 0.65) / 0.35;
          const s = p.size;
          ctx.fillStyle = p.color;
          ctx.strokeStyle = 'rgba(10,50,30,.5)';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(0, -s);
          ctx.quadraticCurveTo(s * 0.75, 0, 0, s);
          ctx.quadraticCurveTo(-s * 0.75, 0, 0, -s);
          ctx.fill();
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, -s * 0.8);
          ctx.lineTo(0, s * 0.8);
          ctx.strokeStyle = 'rgba(10,50,30,.35)';
          ctx.stroke();
          ctx.restore();
        } else if (p.kind === 'glyph') {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.globalAlpha = 1 - q * q;
          ctx.font = `bold ${p.size}px KaiTi, STKaiti, serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,.5)';
          ctx.strokeText(p.text, 0, 0);
          ctx.fillStyle = p.color;
          ctx.fillText(p.text, 0, 0);
          ctx.restore();
        }
      }

      // 发光层（加色混合）
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const p of this.list) {
        if (p.delay > 0) continue;
        const q = p.t / p.life;
        if (p.kind === 'spark') {
          const a = 1 - q;
          ctx.globalAlpha = a;
          ctx.strokeStyle = p.color;
          ctx.fillStyle = p.color;
          ctx.lineWidth = p.size * 0.7;
          ctx.lineCap = 'round';
          const tail = p.streak || 1;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.022 * tail, p.y - p.vy * 0.022 * tail);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 0.55, 0, TAU);
          ctx.fill();
        } else if (p.kind === 'ring') {
          const e = 1 - Math.pow(1 - q, 3);
          const r = p.r0 + (p.r1 - p.r0) * e;
          ctx.globalAlpha = (1 - q) * 0.9;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.width * (1 - q) + 0.5;
          ctx.lineCap = 'round';
          ctx.beginPath();
          if (p.arcLen) {
            ctx.arc(p.x, p.y, r, p.arcStart, p.arcStart + p.arcLen);
          } else {
            ctx.arc(p.x, p.y, r, 0, TAU);
          }
          ctx.stroke();
        } else if (p.kind === 'field') {
          // 象：翠玉"田"字印，正方形外框 + 十字，自中心扩散
          const e = 1 - Math.pow(1 - q, 3);
          const s = p.r0 + (p.r1 - p.r0) * e;
          ctx.globalAlpha = (1 - q) * 0.85;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 5 * (1 - q) + 0.6;
          ctx.lineCap = 'round';
          ctx.save();
          ctx.translate(p.x, p.y);
          if (p.rotated) ctx.rotate(Math.PI / 4);
          ctx.strokeRect(-s / 2, -s / 2, s, s);
          ctx.beginPath();
          ctx.moveTo(-s / 2, 0);
          ctx.lineTo(s / 2, 0);
          ctx.moveTo(0, -s / 2);
          ctx.lineTo(0, s / 2);
          ctx.stroke();
          ctx.restore();
        } else if (p.kind === 'ray') {
          const e = 1 - Math.pow(1 - q, 2);
          const len = p.len0 + (p.len1 - p.len0) * e;
          ctx.globalAlpha = (1 - q) * 0.75;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.width * (1 - q) + 0.4;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x + Math.cos(p.angle) * 14, p.y + Math.sin(p.angle) * 14);
          ctx.lineTo(p.x + Math.cos(p.angle) * len, p.y + Math.sin(p.angle) * len);
          ctx.stroke();
        } else if (p.kind === 'slash') {
          const e = 1 - Math.pow(1 - q, 2);
          ctx.globalAlpha = (1 - q);
          ctx.strokeStyle = '#fff3c4';
          ctx.lineWidth = 7 * (1 - q) + 1;
          ctx.lineCap = 'round';
          const rad = 40 + p.grow * e;
          ctx.beginPath();
          ctx.arc(p.x, p.y, rad, p.dir * -0.4 - p.span / 2, p.dir * -0.4 + p.span / 2);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(255,210,77,.6)';
          ctx.lineWidth = 14 * (1 - q);
          ctx.beginPath();
          ctx.arc(p.x, p.y, rad, p.dir * -0.4 - p.span / 2, p.dir * -0.4 + p.span / 2);
          ctx.stroke();
        }
      }
      ctx.restore();

      // 浮字（最上层）
      for (const p of this.list) {
        if (p.kind !== 'floater' || p.delay > 0) continue;
        const q = p.t / p.life;
        const scale = q < 0.18 ? 0.4 + (q / 0.18) * 0.72 : 1.12 - q * 0.12;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(scale, scale);
        ctx.globalAlpha = q < 0.75 ? 1 : 1 - (q - 0.75) / 0.25;
        ctx.font = `bold ${p.size}px KaiTi, STKaiti, "楷体", serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.letterSpacing = '6px';
        ctx.lineWidth = p.royal ? 9 : 6;
        ctx.strokeStyle = p.royal || p.tint === 'fire' ? 'rgba(120,40,0,.85)'
          : p.tint === 'jade' ? 'rgba(0,45,22,.85)'
          : 'rgba(20,10,0,.8)';
        ctx.strokeText(p.text, 0, 0);
        const g = ctx.createLinearGradient(0, -p.size / 2, 0, p.size / 2);
        if (p.royal || p.tint === 'fire') {
          g.addColorStop(0, '#fff8d8');
          g.addColorStop(0.5, '#ffd24d');
          g.addColorStop(1, '#ff7a18');
        } else if (p.tint === 'jade') {
          g.addColorStop(0, '#f6ffe8');
          g.addColorStop(1, '#3fbf7a');
        } else if (p.tint === 'star') {
          g.addColorStop(0, '#ffffff');
          g.addColorStop(1, '#e8b64a');
        } else {
          g.addColorStop(0, '#fff3c4');
          g.addColorStop(1, '#ffb43a');
        }
        ctx.fillStyle = g;
        ctx.fillText(p.text, 0, 0);
        ctx.restore();
      }

      // 中心闪光
      if (this.flash) {
        const f = this.flash;
        const q = f.t / f.max;
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r);
        g.addColorStop(0, `rgba(255,250,235,${0.85 * (1 - q)})`);
        g.addColorStop(0.4, `rgba(255,220,150,${0.4 * (1 - q)})`);
        g.addColorStop(1, 'rgba(255,200,120,0)');
        ctx.fillStyle = g;
        ctx.fillRect(f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
      }
    }

    clear() {
      this.list.length = 0;
      this.flash = null;
      this.shakeMag = 0;
      this.shakeX = 0;
      this.shakeY = 0;
    }
  }

  // ---------------- WebAudio 合成音效 ----------------
  class Sound {
    constructor() {
      this.ctx = null;
      this.muted = false;
      this._noise = null;
    }

    unlock() {
      if (this.ctx) {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const len = this.ctx.sampleRate;
      this._noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this._noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }

    setMuted(m) {
      this.muted = m;
    }

    _env(gain, t0, peak, decay) {
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
    }

    _tone(type, f0, f1, dur, peak, t0) {
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
      this._env(g, t0, peak, dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    _noiseHit(dur, peak, filterType, f0, f1, t0) {
      const ctx = this.ctx;
      const src = ctx.createBufferSource();
      src.buffer = this._noise;
      src.loop = true;
      const flt = ctx.createBiquadFilter();
      flt.type = filterType;
      flt.frequency.setValueAtTime(f0, t0);
      flt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t0 + dur);
      flt.Q.value = 1.1;
      const g = ctx.createGain();
      this._env(g, t0, peak, dur);
      src.connect(flt).connect(g).connect(ctx.destination);
      src.start(t0);
      src.stop(t0 + dur + 0.02);
    }

    select() {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime;
      this._tone('triangle', 760, 600, 0.06, 0.12, t);
    }

    illegal() {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime;
      this._tone('square', 180, 120, 0.1, 0.06, t);
    }

    move() {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime;
      this._noiseHit(0.07, 0.25, 'lowpass', 900, 300, t);
      this._tone('sine', 200, 110, 0.09, 0.22, t);
    }

    // 吃子音效按攻击子分型：车剑鸣/马蹄/炮轰/玉磬/金铁/破空/锣
    capture(atkType) {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime;
      if (atkType === 'r') {
        this._noiseHit(0.16, 0.22, 'highpass', 2200, 900, t);  // 挥剑破空
        this._tone('sawtooth', 1400, 640, 0.2, 0.14, t);       // 剑鸣
        this._tone('sine', 2100, 1500, 0.3, 0.12, t + 0.01);   // 金属颤
        this._tone('sine', 130, 40, 0.28, 0.3, t);
      } else if (atkType === 'h') {
        this._tone('sine', 130, 45, 0.18, 0.42, t);            // 双蹄闷响
        this._tone('sine', 110, 40, 0.2, 0.34, t + 0.09);
        this._noiseHit(0.22, 0.26, 'lowpass', 700, 200, t);    // 扬尘
      } else if (atkType === 'c') {
        this._noiseHit(0.45, 0.5, 'lowpass', 1400, 120, t);    // 烈焰爆
        this._tone('sine', 90, 30, 0.5, 0.55, t);
        this._noiseHit(0.3, 0.34, 'bandpass', 2600, 300, t);
      } else if (atkType === 'e') {
        this._tone('sine', 1320, 1320, 0.18, 0.2, t);          // 翠玉磬
        this._tone('sine', 1980, 1760, 0.3, 0.12, t + 0.02);
        this._noiseHit(0.22, 0.3, 'bandpass', 3400, 1200, t);  // 玉碎
        this._tone('sine', 160, 60, 0.24, 0.22, t);
      } else if (atkType === 'a') {
        this._tone('triangle', 2400, 1900, 0.16, 0.16, t);     // 金铁交鸣
        this._tone('triangle', 3200, 2400, 0.12, 0.08, t + 0.01);
        this._noiseHit(0.12, 0.2, 'highpass', 3200, 1600, t);
        this._tone('sine', 150, 70, 0.18, 0.18, t);
      } else if (atkType === 'p') {
        this._noiseHit(0.1, 0.3, 'highpass', 1800, 3000, t);   // 短促破空
        this._tone('triangle', 940, 700, 0.12, 0.18, t);
        this._tone('sine', 140, 60, 0.16, 0.2, t);
      } else if (atkType === 'k') {
        this._tone('sine', 520, 180, 0.9, 0.4, t);             // 将坠：锣
        this._tone('sine', 780, 520, 0.9, 0.2, t);
        this._noiseHit(0.7, 0.3, 'lowpass', 2000, 200, t);
      }
    }

    check() {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime;
      this._tone('square', 440, 440, 0.12, 0.14, t);
      this._tone('square', 660, 660, 0.2, 0.14, t + 0.14);
    }

    win() {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime;
      [523, 659, 784, 1047].forEach((f, i) => {
        this._tone('triangle', f, f, 0.3, 0.2, t + i * 0.12);
      });
    }

    lose() {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime;
      this._tone('sawtooth', 330, 220, 0.4, 0.14, t);
      this._tone('sawtooth', 262, 165, 0.55, 0.14, t + 0.22);
    }

    ui() {
      if (!this.ctx || this.muted) return;
      const t = this.ctx.currentTime;
      this._tone('triangle', 520, 560, 0.05, 0.1, t);
    }
  }

  // 攻击子主色（突进光带/聚气环用），取各型调色板的高亮色
  function captureColor(atkType) {
    return (CAPTURE_CONF[atkType] || CAPTURE_CONF.p).pal[1];
  }

  global.XQFX = { Particles, Sound, TAU, captureColor };
})(typeof window !== 'undefined' ? window : globalThis);
