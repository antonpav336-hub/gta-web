/**
 * ObjectPool — пул объектов для трассеров, искр, гильз и т.п.
 * Объекты создаются заранее; в игре только acquire()/release() (без GC).
 * Если свободных нет — переиспользуется самый старый активный.
 */
export class ObjectPool {
  constructor(create, size, onAcquire = null, onRelease = null) {
    this.free = [];
    this.active = [];
    this.onAcquire = onAcquire;
    this.onRelease = onRelease;
    for (let i = 0; i < size; i++) {
      const o = create(i);
      if (onRelease) onRelease(o);
      this.free.push(o);
    }
  }

  acquire() {
    let o = this.free.pop();
    if (!o) {
      o = this.active.shift();           // крадём самый старый
      if (this.onRelease) this.onRelease(o);
    }
    this.active.push(o);
    if (this.onAcquire) this.onAcquire(o);
    return o;
  }

  release(o) {
    const i = this.active.indexOf(o);
    if (i === -1) return;
    this.active[i] = this.active[this.active.length - 1];
    this.active.pop();
    if (this.onRelease) this.onRelease(o);
    this.free.push(o);
  }
}
