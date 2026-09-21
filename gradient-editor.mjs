import { MAX_STOPS, stopColor, gradientModel, sampleGradient, colorCSS } from './gradient.mjs?v=5ccfb07b44ef';

export function createGradientEditor() {
  const el = id => document.getElementById(id);
  let nextId = 3, selected = 1, stepping = 0;
  let stops = [
    { id: 1, position: 0, color: '#db4275', shade: 50 },
    { id: 2, position: 100, color: '#3aa8be', shade: 50 }
  ];
  const state = { model: null, revision: 0 };
  const handles = new Map();
  let lastTap = null;
  const DELETE_DISTANCE = 64;
  const current = () => stops.find(stop => stop.id === selected);
  const ordered = () => [...stops].sort((a, b) => a.position - b.position);
  function paint(canvas, model) {
    const ctx = canvas.getContext('2d');
    const data = ctx.createImageData(canvas.width, 1);
    for (let x = 0; x < canvas.width; x++) {
      const color = sampleGradient(model, x / (canvas.width - 1));
      color.forEach((c, i) => data.data[x * 4 + i] = Math.round(c * 255));
      data.data[x * 4 + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
  }
  function render() {
    const stop = current(), sorted = ordered();
    state.model = gradientModel(stops, stepping);
    state.revision++;
    paint(el('gradient-stops-preview'), gradientModel(stops, 0));
    paint(el('gradient-result'), state.model);
    el('stop-color').value = stop.color;
    el('stop-shade').value = stop.shade;
    el('stop-shade-value').value = `${stop.shade}%`;
    el('stop-shade').setAttribute('aria-valuetext', stop.shade === 50 ? 'Original color, 50%' : `${stop.shade}% from black to white`);
    el('stop-shade').style.setProperty('--range-track', `linear-gradient(to right, #000 22px, ${stop.color} 50%, #fff calc(100% - 22px))`);
    el('stepping-value').value = `${Math.round(stepping * 100)}%`;
    for (const button of el('stop-swatches').children) button.setAttribute('aria-pressed', String(button.dataset.color === stop.color));
    for (const [id, button] of handles) if (!stops.some(item => item.id === id)) { button.remove(); handles.delete(id); }
    sorted.forEach((item, index) => {
      let button = handles.get(item.id);
      if (!button) {
        button = document.createElement('button'); button.type = 'button'; button.className = 'gradient-stop';
        button.dataset.id = item.id;
        button.addEventListener('click', () => {
          if (!stops.some(stop => stop.id === item.id)) return;
          selected = item.id; render();
        });
        button.addEventListener('pointerdown', event => {
          if (event.button !== 0 || !event.isPrimary) return;
          selected = item.id; el('stop-status').textContent = ''; render();
          button.setPointerCapture(event.pointerId);
          const startX = event.clientX, startY = event.clientY, startPosition = item.position;
          const railWidth = el('gradient-stops-preview').getBoundingClientRect().width;
          let moved = false, pendingDelete = false;
          const move = e => {
            const dx = e.clientX - startX, dy = e.clientY - startY;
            if (!moved && Math.hypot(dx, dy) < 5) return;
            moved = true; lastTap = null;
            pendingDelete = dy >= DELETE_DISTANCE;
            button.style.setProperty('--drag-y', `${Math.max(0, dy)}px`);
            button.classList.toggle('pending-delete', pendingDelete && stops.length > 2);
            el('stop-status').textContent = pendingDelete ? (stops.length > 2 ? 'Release to remove stop' : 'Keep at least two stops') : '';
            if (!pendingDelete) moveStop(startPosition + dx / railWidth * 100);
          };
          const finish = e => {
            button.removeEventListener('pointermove', move);
            button.removeEventListener('pointerup', finish);
            button.removeEventListener('pointercancel', finish);
            button.removeEventListener('lostpointercapture', finish);
            button.style.removeProperty('--drag-y');
            button.classList.remove('pending-delete');
            el('stop-status').textContent = '';
            if (e.type !== 'pointerup') { item.position = startPosition; lastTap = null; render(); return; }
            if (pendingDelete) { lastTap = null; deleteStop(); return; }
            if (!moved) {
              const now = performance.now();
              if (lastTap && lastTap.id === item.id && now - lastTap.time < 350 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 24) {
                lastTap = null; deleteStop();
              } else lastTap = { id: item.id, time: now, x: e.clientX, y: e.clientY };
            }
          };
          button.addEventListener('pointermove', move);
          button.addEventListener('pointerup', finish);
          button.addEventListener('pointercancel', finish);
          button.addEventListener('lostpointercapture', finish);
        });
        button.addEventListener('keydown', event => {
          const moves = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 };
          if (event.key in moves || ['Home', 'End'].includes(event.key)) {
            event.preventDefault(); selected = item.id;
            moveStop(event.key === 'Home' ? 0 : event.key === 'End' ? 100 : item.position + moves[event.key] * (event.shiftKey ? 10 : 1));
          }
          if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); selected = item.id; deleteStop(); }
        });
        handles.set(item.id, button); el('stop-handles').appendChild(button);
      }
      button.style.left = `${item.position}%`;
      button.style.setProperty('--stop-color', colorCSS(stopColor(item)));
      button.setAttribute('aria-label', `Stop ${index + 1}, ${item.position}%. Double-tap or drag down to remove. Arrow keys move; Delete removes.`);
      button.setAttribute('aria-pressed', String(item.id === selected));
    });
  }
  function positionAt(clientX) {
    const rect = el('gradient-stops-preview').getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(100, (clientX - rect.left) / rect.width * 100)) * 10) / 10;
  }
  function moveStop(position) {
    if (!Number.isFinite(position)) return;
    const stop = current();
    const sorted = ordered(), index = sorted.indexOf(stop);
    const min = index > 0 ? sorted[index - 1].position + .1 : 0;
    const max = index < sorted.length - 1 ? sorted[index + 1].position - .1 : 100;
    stop.position = Math.round(Math.max(min, Math.min(max, position)) * 10) / 10;
    render();
  }
  function addStop(position) {
    if (stops.length >= MAX_STOPS) { el('stop-status').textContent = `Maximum ${MAX_STOPS} stops`; return; }
    const nearby = stops.find(stop => Math.abs(stop.position - position) < .1);
    if (nearby) { selected = nearby.id; render(); return; }
    const rgb = sampleGradient(gradientModel(stops, 0), position / 100);
    const color = '#' + rgb.map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
    el('stop-status').textContent = '';
    selected = nextId++;
    stops.push({ id: selected, position, color, shade: 50 });
    render(); handles.get(selected).focus({ preventScroll: true });
  }
  function deleteStop() {
    if (stops.length <= 2) { el('stop-status').textContent = 'Keep at least two stops'; return; }
    const sorted = ordered(), index = sorted.findIndex(stop => stop.id === selected);
    stops = stops.filter(stop => stop.id !== selected);
    selected = sorted[index === 0 ? 1 : index - 1].id;
    render(); handles.get(selected).focus({ preventScroll: true });
  }
  el('gradient-stops-preview').addEventListener('click', event => addStop(positionAt(event.clientX)));
  el('gradient-stops-preview').addEventListener('keydown', event => {
    if (!['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    const sorted = ordered(); let position = 50, gap = -1;
    for (let i = 0; i < sorted.length - 1; i++) {
      const width = sorted[i + 1].position - sorted[i].position;
      if (width > gap) { gap = width; position = (sorted[i].position + sorted[i + 1].position) / 2; }
    }
    addStop(Math.round(position * 10) / 10);
  });
  el('stop-color').addEventListener('input', event => { current().color = event.target.value; render(); });
  el('stop-shade').addEventListener('input', event => { current().shade = +event.target.value; render(); });
  el('stepping').addEventListener('input', event => { stepping = +event.target.value / 100; render(); });
  const tokens = getComputedStyle(document.documentElement);
  for (const name of ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple']) {
    const hex = tokens.getPropertyValue('--color-' + name).trim();
    const button = document.createElement('button'); button.type = 'button'; button.className = 'swatch';
    button.dataset.color = hex; button.style.backgroundColor = hex; button.title = name;
    button.setAttribute('aria-label', `${name} ${hex}`);
    button.addEventListener('click', () => { current().color = hex; render(); });
    el('stop-swatches').appendChild(button);
  }
  render();
  return state;
}
