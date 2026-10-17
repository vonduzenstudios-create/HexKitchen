// Keyboard + mouse state with pointer lock. Edge-triggered presses are cleared every frame by endFrame().

export class Input {
  readonly keys = new Set<string>();
  private pressed = new Set<string>();
  mouseDX = 0;
  mouseDY = 0;
  wheel = 0;
  lmb = false;
  rmb = false;
  lmbPressed = false;
  lmbReleased = false;
  rmbPressed = false;
  rmbReleased = false;
  locked = false;
  onLockChange: (locked: boolean) => void = () => {};

  constructor(private el: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.pressed.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.lmb = this.rmb = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // Clamp spikes some browsers produce on lock/unlock.
      this.mouseDX += Math.max(-200, Math.min(200, e.movementX));
      this.mouseDY += Math.max(-200, Math.min(200, e.movementY));
    });
    window.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) {
        this.lmb = true;
        this.lmbPressed = true;
      } else if (e.button === 2) {
        this.rmb = true;
        this.rmbPressed = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0 && this.lmb) {
        this.lmb = false;
        this.lmbReleased = true;
      } else if (e.button === 2 && this.rmb) {
        this.rmb = false;
        this.rmbReleased = true;
      }
    });
    window.addEventListener('wheel', (e) => (this.wheel += Math.sign(e.deltaY)), { passive: true });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) {
        this.lmb = this.rmb = false;
        this.keys.clear();
      }
      this.onLockChange(this.locked);
    });
  }

  requestLock(): void {
    try {
      const p = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      /* ignored: user can click again */
    }
  }

  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  endFrame(): void {
    this.pressed.clear();
    this.mouseDX = this.mouseDY = this.wheel = 0;
    this.lmbPressed = this.lmbReleased = this.rmbPressed = this.rmbReleased = false;
  }
}
