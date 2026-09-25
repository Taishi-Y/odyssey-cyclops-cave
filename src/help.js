// ---------------------------------------------------------------- help screen (controls + HUD guide)
// H / F1 / ? toggles it, Esc closes. While open during play the world is frozen (like photo mode).
const CONTROLS = [
  ['Move', 'WASD or Arrow keys', 'Left stick'],
  ['Look', 'Mouse', 'Drag on the right side'],
  ['Run', 'Shift', 'Push the stick all the way'],
  ['Crouch', 'Ctrl or C', 'CROUCH'],
  ['Prone (crawl)', 'Z', 'PRONE'],
  ['Jump', 'Space', 'JUMP'],
  ['Attack', 'Left click (bow: hold to draw, release to shoot / spear: throw)', 'Hold 🏹, release to shoot'],
  ['Aim', 'Right click', 'Hold 🏹 and drag'],
  ['Interact / pick up / eat', 'E (hold E for "hold" actions)', 'E'],
  ['Weapons', '1 bow / 2 spear / 3 stones', 'WEAPON'],
  ['Weapon wheel (time slows)', 'Tab (hold)', 'WHEEL'],
  ['Knock on a wall (lure the giant)', 'F', 'KNOCK'],
  ['Switch to a crewman', 'X', 'SWITCH'],
  ['Order the crew: all attack / scatter', 'G / R', ''],
  ['Camera (3rd / 1st person)', 'V', 'CAM'],
  ['Photo mode', 'P', 'PHOTO'],
  ['Help (this screen)', 'H or F1', '?'],
];

const ACTIONS = [
  ['Air slow motion', 'Jump, then aim the bow in mid-air. The world slows down while stamina lasts.'],
  ['Climb', 'Walk into a rock face to climb it.'],
  ['Hide', 'Crouch or go prone next to a straw pile. "HIDDEN" appears when you are safe.'],
  ['Distract', 'Throw stones (3) or knock on a wall (F). The giant walks to the noise.'],
  ['Break free', 'If the giant grabs you, mash E / Space (tap on phones).'],
  ['Blind the giant', 'A timing strike: press E when the two rings meet.'],
  ['Heal', 'Eat cheese (E). Pick up arrows and stones from the floor.'],
];

const HUD = [
  ['Objective', 'Top left', 'What to do next.'],
  ['Soliton radar', 'Top right', 'Map around you. The colored cone is the giant\'s field of view (blue calm, orange searching, yellow cautious). Stay out of it. Turns red with JAMMING during ALERT.'],
  ['"!" / "?"', 'Over the giant', 'Red "!" = he saw you. Yellow "?" = he heard or half-saw something.'],
  ['Phase + timer', 'Under the radar', 'ALERT: you were seen. EVASION: break line of sight until the timer runs out. CAUTION: he is still searching.'],
  ['Awareness meter', 'Over the giant\'s head', 'Triangle that fills white, orange, then red as he notices you. At the screen edge it points toward him.'],
  ['HIDDEN', 'Bottom center', 'You are hidden in a straw pile.'],
  ['Stamina wheel', 'Left of the crosshair', 'Green ring. Drains when you sprint or slow time. Red = exhausted, wait for it to refill.'],
  ['Crosshair', 'Center', 'Grows while aiming. "WEAK POINT" = on the eye, "HEAD" = on the head.'],
  ['Health and men', 'Bottom left', 'Your HP bar and how many of your 12 men are alive. Also shows Crouching / Prone / Wearing straw.'],
  ['Weapon', 'Bottom right', 'Current weapon and ammo left.'],
  ['Prompt', 'Below the center', 'The action E will do right now. A bar shows progress for hold actions.'],
  ['Red edges', 'Whole screen', 'You took damage.'],
];

const row3 = (a, b, c) => `<tr><th>${a}</th><td class="kc">${b}</td><td class="tc">${c}</td></tr>`;

export class HelpScreen {
  constructor(game) {
    this.g = game; this.on = false;
    const el = document.createElement('div'); el.id = 'help';
    el.innerHTML = `
      <div class="panel">
        <div class="head"><span class="title">HOW TO PLAY</span><button class="close" aria-label="Close">✕</button></div>
        <div class="tabs"><button data-tab="controls" class="on">CONTROLS</button><button data-tab="actions">ACTIONS</button><button data-tab="hud">SCREEN</button></div>
        <div class="page on" data-page="controls">
          <table><tr class="cols"><th></th><td class="kc">Keyboard / mouse</td><td class="tc">Touch</td></tr>${CONTROLS.map((r) => row3(...r)).join('')}</table>
        </div>
        <div class="page" data-page="actions">
          <table>${ACTIONS.map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join('')}</table>
        </div>
        <div class="page" data-page="hud">
          <table><tr class="cols"><th></th><td>Where</td><td>Meaning</td></tr>${HUD.map(([a, b, c]) => `<tr><th>${a}</th><td class="where">${b}</td><td>${c}</td></tr>`).join('')}</table>
        </div>
        <div class="foot">H / F1 / Esc to close · ← → to change tab</div>
      </div>`;
    document.body.appendChild(el);
    this.el = el;
    this.tabs = [...el.querySelectorAll('.tabs button')];
    this.tabs.forEach((b) => b.addEventListener('click', () => this.tab(b.dataset.tab)));
    el.querySelector('.close').addEventListener('click', () => this.toggle(false));
    el.addEventListener('mousedown', (e) => { e.stopPropagation(); if (e.target === el) this.toggle(false); });
    el.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    addEventListener('keydown', (e) => {
      const key = e.code === 'KeyH' || e.code === 'F1' || e.key === '?';
      if (key) { e.preventDefault(); this.toggle(); return; }
      if (!this.on) return;
      if (e.code === 'Escape') this.toggle(false);
      if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
        const i = this.tabs.findIndex((b) => b.classList.contains('on'));
        const n = (i + (e.code === 'ArrowRight' ? 1 : this.tabs.length - 1)) % this.tabs.length;
        this.tab(this.tabs[n].dataset.tab);
      }
    });
  }
  tab(id) {
    this.tabs.forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
    this.el.querySelectorAll('.page').forEach((p) => p.classList.toggle('on', p.dataset.page === id));
  }
  toggle(on = !this.on) {
    const G = this.g;
    if (on === this.on) return;
    if (on && G.photo?.on) return;
    this.on = on;
    this.el.classList.toggle('on', on);
    document.body.classList.toggle('helpopen', on);
    if (on) document.exitPointerLock?.();
    G.input.keys.clear(); G.input.just.clear(); G.input.mouseDown = [false, false, false];
  }
}
