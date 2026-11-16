// P1xel Lab — RGB color picker used all over Create (and for launcher themes)
(function () {
  const KEY = 'p1xellab-recent-colors';
  const PRESETS = ['#000000', '#ffffff', '#7f7f7f', '#c8c8c8', '#ff3fd2', '#8b2cff', '#14e0ff', '#2bd96b', '#ffe14d', '#ff8a1f', '#e8323c', '#7a4a24', '#2b4dff', '#0e8a4a', '#5decf5', '#ff9ecd'];
  let recent = [];
  try { recent = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch {}
  const hex2rgb = h => [1, 3, 5].map(i => parseInt(h.substr(i, 2), 16));
  const rgb2hex = rgb => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const valid = h => /^#[0-9a-f]{6}$/i.test(h);
  let pop = null, done = null;

  function close() {
    if (!pop) return;
    const h = pop.dataset.hex;
    if (valid(h)) { recent = [h, ...recent.filter(x => x !== h)].slice(0, 10); try { localStorage.setItem(KEY, JSON.stringify(recent)); } catch {} }
    pop.remove(); pop = null; done && done(h); done = null;
  }
  // Opens next to `anchor`. onChange(hex) runs live while you pick; onDone(hex) when it closes.
  function open(anchor, hex, onChange, onDone) {
    close();
    hex = valid(hex) ? hex.toLowerCase() : '#8b2cff';
    done = onDone || null;
    pop = document.createElement('div');
    pop.className = 'cpick';
    pop.innerHTML = `
      <div class="cp-top"><span class="cp-swatch"></span><input class="cp-hex" maxlength="7" spellcheck="false"><label class="cp-more" title="More colors"><input type="color">🎨</label></div>
      ${['R', 'G', 'B'].map((c, i) => `<label class="cp-row"><b class="cp-${c}">${c}</b><input type="range" min="0" max="255" data-ch="${i}"><input type="number" min="0" max="255" data-chn="${i}"></label>`).join('')}
      <div class="cp-grid">${PRESETS.map(c => `<button data-hex="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>
      ${recent.length ? `<small>Recent</small><div class="cp-grid">${recent.map(c => `<button data-hex="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>` : ''}
      <button class="btn btn-primary cp-ok">Done</button>`;
    document.body.append(pop);
    const r = anchor.getBoundingClientRect();
    const top = Math.min(window.innerHeight - pop.offsetHeight - 10, r.bottom + 6), left = Math.min(window.innerWidth - pop.offsetWidth - 10, r.left);
    pop.style.top = Math.max(10, top) + 'px'; pop.style.left = Math.max(10, left) + 'px';
    const set = (h, from) => {
      h = h.toLowerCase(); pop.dataset.hex = h;
      const rgb = hex2rgb(h);
      pop.querySelector('.cp-swatch').style.background = h;
      if (from !== 'hex') pop.querySelector('.cp-hex').value = h;
      pop.querySelector('input[type=color]').value = h;
      rgb.forEach((v, i) => { if (from !== 'range' + i) pop.querySelector(`[data-ch="${i}"]`).value = v; if (from !== 'num' + i) pop.querySelector(`[data-chn="${i}"]`).value = v; });
      pop.querySelectorAll('[data-ch]').forEach((el, i) => {
        const a = [...rgb], b = [...rgb]; a[i] = 0; b[i] = 255;
        el.style.background = `linear-gradient(90deg, ${rgb2hex(a)}, ${rgb2hex(b)})`;
      });
      onChange && onChange(h);
    };
    const fromChannels = (src) => rgb2hex([0, 1, 2].map(i => +pop.querySelector(src === 'num' ? `[data-chn="${i}"]` : `[data-ch="${i}"]`).value));
    pop.addEventListener('input', e => {
      const t = e.target;
      if (t.dataset.ch) set(fromChannels('range'), 'range' + t.dataset.ch);
      else if (t.dataset.chn) set(fromChannels('num'), 'num' + t.dataset.chn);
      else if (t.classList.contains('cp-hex')) { let v = t.value.trim(); if (!v.startsWith('#')) v = '#' + v; if (valid(v)) set(v, 'hex'); }
      else if (t.type === 'color') set(t.value);
    });
    pop.addEventListener('click', e => {
      const b = e.target.closest('[data-hex]'); if (b) set(b.dataset.hex);
      if (e.target.classList.contains('cp-ok')) close();
    });
    pop.addEventListener('pointerdown', e => e.stopPropagation());
    set(hex);
  }
  document.addEventListener('pointerdown', e => { if (pop && !pop.contains(e.target)) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  // A small button that shows a color and opens the picker
  function swatch(id, hex, title = 'Pick any color') {
    return `<button type="button" class="cp-btn" id="${id}" title="${title}" style="--c:${valid(hex) ? hex : '#8b2cff'}"><i></i>RGB</button>`;
  }
  function bind(el, getHex, onChange) {
    if (!el) return;
    el.onclick = () => open(el, getHex(), h => { el.style.setProperty('--c', h); onChange(h); });
  }
  window.ColorPicker = { open, close, swatch, bind, hex2rgb, rgb2hex };
})();
