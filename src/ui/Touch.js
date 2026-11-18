/**
 * TouchControls — экранные кнопки и джойстик для телефона.
 * Пишут напрямую в состояние InputManager (keys / mouse / mouseDX), поэтому остальной код не меняется.
 */
export class TouchControls {
  constructor(input) {
    this.input = input;
    const root = this.root = document.createElement('div');
    root.style.cssText = 'position:fixed;inset:0;z-index:6;display:none;touch-action:none;user-select:none;-webkit-user-select:none;';
    document.body.appendChild(root);

    // Зона обзора (правая часть экрана)
    const look = document.createElement('div');
    look.style.cssText = 'position:absolute;right:0;top:0;width:58%;height:100%;touch-action:none;';
    root.appendChild(look);
    let lp = null;
    look.addEventListener('pointerdown', (e) => { lp = { id: e.pointerId, x: e.clientX, y: e.clientY }; look.setPointerCapture(e.pointerId); });
    look.addEventListener('pointermove', (e) => {
      if (!lp || lp.id !== e.pointerId) return;
      input.mouseDX += (e.clientX - lp.x) * 1.7;
      input.mouseDY += (e.clientY - lp.y) * 1.7;
      lp.x = e.clientX; lp.y = e.clientY;
    });
    const endLook = (e) => { if (lp && lp.id === e.pointerId) lp = null; };
    look.addEventListener('pointerup', endLook);
    look.addEventListener('pointercancel', endLook);

    // Плавающий джойстик (левая часть экрана)
    const zone = document.createElement('div');
    zone.style.cssText = 'position:absolute;left:0;top:0;width:42%;height:100%;touch-action:none;';
    root.appendChild(zone);
    const base = document.createElement('div');
    base.style.cssText = 'position:absolute;width:130px;height:130px;border-radius:50%;border:2px solid #fff6;background:#ffffff14;display:none;';
    const knob = document.createElement('div');
    knob.style.cssText = 'position:absolute;left:35px;top:35px;width:60px;height:60px;border-radius:50%;background:#ffffff55;';
    base.appendChild(knob);
    zone.appendChild(base);
    let jp = null;
    const setDir = (x, y) => {
      const k = input.keys, T = 0.3;
      const f = (code, on) => { if (on) k.add(code); else k.delete(code); };
      f('KeyW', y < -T); f('KeyS', y > T); f('KeyA', x < -T); f('KeyD', x > T);
    };
    zone.addEventListener('pointerdown', (e) => {
      const r = zone.getBoundingClientRect();
      jp = { id: e.pointerId, cx: e.clientX, cy: e.clientY };
      base.style.display = 'block';
      base.style.left = (e.clientX - r.left - 65) + 'px';
      base.style.top = (e.clientY - r.top - 65) + 'px';
      knob.style.transform = 'translate(0,0)';
      zone.setPointerCapture(e.pointerId);
    });
    zone.addEventListener('pointermove', (e) => {
      if (!jp || jp.id !== e.pointerId) return;
      let dx = e.clientX - jp.cx, dy = e.clientY - jp.cy;
      const len = Math.hypot(dx, dy), R = 55;
      if (len > R) { dx = dx / len * R; dy = dy / len * R; }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      setDir(dx / R, dy / R);
    });
    const endJoy = (e) => {
      if (!jp || jp.id !== e.pointerId) return;
      jp = null; base.style.display = 'none'; setDir(0, 0);
    };
    zone.addEventListener('pointerup', endJoy);
    zone.addEventListener('pointercancel', endJoy);

    // Кнопки
    const tap = (code) => () => { input.keys.add(code); input._pressed.add(code); setTimeout(() => input.keys.delete(code), 120); };
    const hold = (code) => ({
      down: () => { input.keys.add(code); input._pressed.add(code); },
      up: () => input.keys.delete(code),
    });
    let aimOn = false, runOn = false;
    const btn = (label, css, handlers, size = 62) => {
      const b = document.createElement('div');
      b.textContent = label;
      b.style.cssText = `position:absolute;${css};width:${size}px;height:${size}px;border-radius:50%;background:#00000066;border:2px solid #fff7;color:#fff;font:700 ${size > 70 ? 15 : 12}px sans-serif;display:flex;align-items:center;justify-content:center;text-align:center;touch-action:none;`;
      const press = (e) => { e.preventDefault(); e.stopPropagation(); b.style.background = '#f2c744aa'; handlers.down && handlers.down(b); };
      const rel = (e) => { e.stopPropagation(); if (!handlers.toggle) b.style.background = '#00000066'; handlers.up && handlers.up(b); };
      b.addEventListener('pointerdown', press);
      b.addEventListener('pointerup', rel);
      b.addEventListener('pointercancel', rel);
      root.appendChild(b);
      return b;
    };
    btn('ОГОНЬ', 'right:24px;bottom:24px', {
      down: () => { input.mouse.left = true; input._leftPressed = true; },
      up: () => { input.mouse.left = false; },
    }, 92);
    btn('ПРЫЖОК', 'right:128px;bottom:34px', hold('Space'));
    btn('E', 'right:24px;bottom:128px', { down: tap('KeyE') });
    btn('ПРИЦЕЛ', 'right:96px;bottom:112px', {
      toggle: true,
      down: (b) => { aimOn = !aimOn; input.mouse.right = aimOn; b.style.background = aimOn ? '#f2c744aa' : '#00000066'; },
    });
    btn('БЕГ', 'right:200px;bottom:34px', {
      toggle: true,
      down: (b) => { runOn = !runOn; if (runOn) input.keys.add('ShiftLeft'); else input.keys.delete('ShiftLeft'); b.style.background = runOn ? '#f2c744aa' : '#00000066'; },
    }, 52);
    btn('R', 'right:24px;bottom:214px', { down: tap('KeyR') }, 48);
    btn('ОРУЖ.', 'right:80px;bottom:214px', { down: () => { input._wheel += 1; } }, 48);
    btn('ГУДОК', 'right:136px;bottom:214px', { down: tap('KeyH') }, 48);
    btn('СИРЕНА', 'right:192px;bottom:214px', { down: tap('KeyG') }, 48);
    btn('ПЕРЕКАТ', 'right:248px;bottom:34px', { down: tap('KeyC') }, 48);
    const pause = btn('II', 'left:50%;top:8px;margin-left:-22px', { down: () => input.pause() }, 44);
    pause.style.opacity = '0.7';
  }

  setActive(on) {
    this.root.style.display = on ? 'block' : 'none';
    if (!on) { this.input.keys.clear(); this.input.mouse.left = this.input.mouse.right = false; }
  }
}
