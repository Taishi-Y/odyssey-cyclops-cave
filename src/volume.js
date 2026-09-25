// ---------------------------------------------------------------- master volume control
// Sliders (title menu + help screen) and keys: - / = to step, M to mute. Saved in localStorage.
export function installVolume(audio) {
  const sliders = [];
  let toastT = 0;
  const toast = document.createElement('div'); toast.id = 'voltoast'; document.body.appendChild(toast);
  const sync = (v) => {
    sliders.forEach((w) => { w.input.value = Math.round(v * 100); w.val.textContent = Math.round(v * 100); });
    toast.textContent = v === 0 ? 'VOLUME  MUTED' : `VOLUME  ${Math.round(v * 100)}`;
  };
  audio.onVolume = sync;
  let lastOn = audio.volume || 0.6;
  const make = () => {
    const el = document.createElement('label'); el.className = 'volume';
    el.innerHTML = '<span class="lbl">VOLUME</span><input type="range" min="0" max="100" step="1"><span class="val"></span>';
    const w = { el, input: el.querySelector('input'), val: el.querySelector('.val') };
    w.input.addEventListener('input', () => audio.setVolume(w.input.value / 100));
    ['mousedown', 'touchstart', 'keydown'].forEach((t) => w.input.addEventListener(t, (e) => e.stopPropagation(), { passive: true }));
    sliders.push(w); sync(audio.volume);
    return el;
  };
  addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    let v = null;
    if (e.code === 'Minus' || e.code === 'NumpadSubtract') v = audio.volume - 0.1;
    else if (e.code === 'Equal' || e.code === 'NumpadAdd') v = audio.volume + 0.1;
    else if (e.code === 'KeyM') v = audio.volume > 0 ? 0 : lastOn;
    if (v === null) return;
    if (audio.volume > 0) lastOn = audio.volume;
    audio.setVolume(Math.round(v * 10) / 10);
    toast.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toast.classList.remove('on'), 1200);
  });
  return make;
}
