export class Input {
  constructor(canvas) {
    this.keys = new Set(); this.just = new Set();
    this.mouse = { dx: 0, dy: 0 }; this.mouseDown = [false, false, false];
    this.locked = false;
    addEventListener('keydown', (e) => { if (!this.keys.has(e.code)) this.just.add(e.code); this.keys.add(e.code); if (['Space', 'Tab'].includes(e.code)) e.preventDefault(); });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('mousemove', (e) => { if (this.locked) { this.mouse.dx += e.movementX; this.mouse.dy += e.movementY; } });
    addEventListener('mousedown', (e) => { if (this.touch) return; this.mouseDown[e.button] = true; if (!this.locked && this.wantLock) canvas.requestPointerLock?.()?.catch?.(() => {}); });
    addEventListener('mouseup', (e) => { if (this.touch) return; this.mouseDown[e.button] = false; });
    addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
    addEventListener('blur', () => { if (this.touch) return; this.keys.clear(); this.mouseDown = [false, false, false]; });
  }
  down(c) { return this.keys.has(c); }
  pressed(c) { return this.just.has(c); }
  endFrame() { this.just.clear(); }
}

// ---------------------------------------------------------------- touch controls (phones / tablets)
export function isTouchDevice() {
  return new URLSearchParams(location.search).has('touch') || (matchMedia('(pointer: coarse)').matches && 'ontouchstart' in window);
}

export function attachTouchControls(input) {
  const root = document.createElement('div');
  root.id = 'touch';
  root.innerHTML = `
    <div id="stick"><div id="knob"></div></div>
    <div id="look"></div>
    <div class="tbtn" id="t-fire">🏹</div>
    <div class="tbtn" id="t-jump">JUMP</div>
    <div class="tbtn" id="t-use">E</div>
    <div class="tbtn" id="t-crouch">CROUCH</div>
    <div class="tbtn small" id="t-weapon">WEAPON</div>
    <div class="tbtn small" id="t-cam">CAM</div>
    <div class="tbtn small" id="t-switch">SWITCH</div>
    <div class="tbtn small" id="t-photo">PHOTO</div>
    <div class="tbtn" id="t-wheel">WHEEL</div>
    <div class="tbtn" id="t-knock">KNOCK</div>
    <div class="tbtn" id="t-prone">PRONE</div>`;
  document.body.appendChild(root);
  input.touch = true;
  document.body.classList.add('touch');
  const stick = root.querySelector('#stick'), knob = root.querySelector('#knob'), look = root.querySelector('#look');
  const K = input.keys;
  const setMove = (x, y) => {
    for (const k of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft']) K.delete(k);
    const m = Math.hypot(x, y);
    if (m < 0.2) return;
    if (y < -0.35) K.add('KeyW'); if (y > 0.35) K.add('KeyS');
    if (x < -0.35) K.add('KeyA'); if (x > 0.35) K.add('KeyD');
    if (m > 0.95) K.add('ShiftLeft');
  };
  // joystick
  let stickId = null, sc = { x: 0, y: 0 };
  stick.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; stickId = t.identifier; const r = stick.getBoundingClientRect(); sc = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; e.preventDefault(); }, { passive: false });
  // camera drag
  let lookId = null, last = null;
  look.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; lookId = t.identifier; last = { x: t.clientX, y: t.clientY }; e.preventDefault(); }, { passive: false });
  window.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        let dx = (t.clientX - sc.x) / 55, dy = (t.clientY - sc.y) / 55; const m = Math.hypot(dx, dy);
        if (m > 1.1) { dx *= 1.1 / m; dy *= 1.1 / m; }
        knob.style.transform = `translate(${dx * 45}px, ${dy * 45}px)`; setMove(dx, dy);
      } else if (t.identifier === lookId || t.identifier === input._fireLookId) {
        const p = t.identifier === lookId ? last : input._fireLast;
        input.mouse.dx += (t.clientX - p.x) * 1.8; input.mouse.dy += (t.clientY - p.y) * 1.8;
        p.x = t.clientX; p.y = t.clientY;
      }
    }
    e.preventDefault();
  }, { passive: false });
  const end = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) { stickId = null; knob.style.transform = ''; setMove(0, 0); }
      if (t.identifier === lookId) lookId = null;
    }
  };
  window.addEventListener('touchend', end); window.addEventListener('touchcancel', end);
  // hold-to-draw fire button (you can also drag on it to aim, like mobile shooters)
  const fire = root.querySelector('#t-fire');
  fire.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; input._fireLookId = t.identifier; input._fireLast = { x: t.clientX, y: t.clientY }; input.mouseDown[0] = true; input.mouseDown[2] = true; fire.classList.add('on'); e.preventDefault(); }, { passive: false });
  const fireEnd = (e) => { for (const t of e.changedTouches) if (t.identifier === input._fireLookId) { input._fireLookId = null; input.mouseDown[0] = false; setTimeout(() => (input.mouseDown[2] = false), 120); fire.classList.remove('on'); } };
  fire.addEventListener('touchend', fireEnd); fire.addEventListener('touchcancel', fireEnd);
  const tap = (id, code) => root.querySelector(id).addEventListener('touchstart', (e) => { if (code === 'Space') input.touchE = true; input.just.add(code); K.add(code); setTimeout(() => K.delete(code), 60); e.preventDefault(); }, { passive: false });
  tap('#t-jump', 'Space'); tap('#t-cam', 'KeyV'); tap('#t-knock', 'KeyF'); tap('#t-switch', 'KeyX'); tap('#t-photo', 'KeyP');
  const prone = root.querySelector('#t-prone');
  prone.addEventListener('touchstart', (e) => { input.just.add('KeyZ'); prone.classList.toggle('on'); e.preventDefault(); }, { passive: false });
  const wheel = root.querySelector('#t-wheel');
  wheel.addEventListener('touchstart', (e) => { K.add('KeyQwheel'); wheel.classList.add('on'); e.preventDefault(); }, { passive: false });
  wheel.addEventListener('touchend', () => { setTimeout(() => K.delete('KeyQwheel'), 30); wheel.classList.remove('on'); });
  // E: tap for actions, hold for "hold E" actions (hardening the stake)
  const use = root.querySelector('#t-use');
  use.addEventListener('touchstart', (e) => { input.touchE = true; input.just.add('KeyE'); K.add('KeyE'); use.classList.add('on'); e.preventDefault(); }, { passive: false });
  use.addEventListener('touchend', () => { K.delete('KeyE'); use.classList.remove('on'); });
  const crouch = root.querySelector('#t-crouch');
  crouch.addEventListener('touchstart', (e) => { if (K.has('KeyC')) { K.delete('KeyC'); crouch.classList.remove('on'); } else { K.add('KeyC'); crouch.classList.add('on'); } e.preventDefault(); }, { passive: false });
  root.querySelector('#t-weapon').addEventListener('touchstart', (e) => { input._w = ((input._w || 0) + 1) % 3; input.just.add(['Digit1', 'Digit2', 'Digit3'][input._w]); e.preventDefault(); }, { passive: false });
  // don't let the 'blur' handler or held keys get stuck
  input.touchRoot = root;
}
