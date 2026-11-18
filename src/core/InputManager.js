/**
 * InputManager — клавиатура + мышь (Pointer Lock) для ПК.
 * Состояние опрашивается в игровом цикле; события только пишут в поля.
 * Разовые действия — через consume*(), сбрасываются при чтении и в конце кадра.
 */
export class InputManager {
  constructor(canvas, overlay, resumeBtn) {
    this.canvas = canvas;
    this.overlay = overlay;

    this.keys = new Set();
    this._pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.sensitivity = 0.0022;
    this.locked = false;
    this.touch = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);

    this.mouse = { left: false, right: false };
    this._leftPressed = false;
    this._wheel = 0;

    this.bind = {
      forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
      sprint: 'ShiftLeft', jump: 'Space', interact: 'KeyE', roll: 'KeyC',
      reload: 'KeyR',
    };

    this.onLockChange = null;   // callback(locked:boolean)
    this._bindEvents(resumeBtn);
  }

  _clearHeld() {
    this.keys.clear();
    this.mouse.left = this.mouse.right = false;
  }

  _bindEvents(resumeBtn) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this._pressed.add(e.code);
      if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this._clearHeld());

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) { this.mouse.left = true; this._leftPressed = true; }
      if (e.button === 2) this.mouse.right = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    window.addEventListener('wheel', (e) => {
      if (this.locked) this._wheel += Math.sign(e.deltaY);
    }, { passive: true });
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    // Кнопка «Продолжить»; если не передана (рассинхрон версий файлов) — ищем в DOM, иначе клик по оверлею
    const btn = resumeBtn || document.getElementById('resume') || this.overlay;
    btn.addEventListener('click', () => this.requestLock());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      this.overlay.classList.toggle('hidden', this.locked);
      if (!this.locked) this._clearHeld();
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  _setLocked(v) {
    this.locked = v;
    this.overlay.classList.toggle('hidden', v);
    if (!v) this._clearHeld();
    if (this.onLockChange) this.onLockChange(v);
  }

  /** Пауза на телефоне (вместо Esc). */
  pause() { if (this.touch && this.locked) this._setLocked(false); }

  requestLock() {
    if (this.touch) {
      this._setLocked(true);
      try {
        const el = document.documentElement;
        if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen().catch(() => {});
        if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
      } catch (e) { /* ignore */ }
      return;
    }
    // unadjustedMovement отключает акселерацию мыши ОС (где поддерживается)
    const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
    if (p && p.catch) p.catch(() => this.canvas.requestPointerLock());
  }

  isDown(action) { return this.keys.has(this.bind[action]); }

  consume(action) { return this.consumeKey(this.bind[action]); }

  /** true один раз после нажатия клавиши по её коду (например 'Digit1'). */
  consumeKey(code) {
    if (this._pressed.has(code)) { this._pressed.delete(code); return true; }
    return false;
  }

  consumeFirePress() {
    const v = this._leftPressed; this._leftPressed = false; return v;
  }

  /** -1 / 0 / +1: прокрутка колеса с прошлого вызова. */
  consumeWheel() {
    const v = Math.sign(this._wheel); this._wheel = 0; return v;
  }

  getMove(out) {
    out.x = (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
    out.y = (this.isDown('forward') ? 1 : 0) - (this.isDown('back') ? 1 : 0);
    const len = Math.hypot(out.x, out.y);
    if (len > 1) { out.x /= len; out.y /= len; }
    return out;
  }

  getLook(out, scale = 1) {
    out.x = this.mouseDX * this.sensitivity * scale;
    out.y = this.mouseDY * this.sensitivity * scale;
    this.mouseDX = 0; this.mouseDY = 0;
    return out;
  }

  endFrame() {
    this._pressed.clear();
    this._leftPressed = false;
  }
}
