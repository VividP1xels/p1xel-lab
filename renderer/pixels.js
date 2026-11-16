// Pixel-art icons drawn as SVG (no image assets needed)
(function () {
  function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }
  function svg(grid, palette, size = 16) {
    const n = grid.length;
    let r = '';
    for (let y = 0; y < n; y++) for (let x = 0; x < grid[y].length; x++) {
      const c = palette[grid[y][x]];
      if (c) r += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${c}"/>`;
    }
    return `<svg viewBox="0 0 ${n} ${n}" width="${size}" height="${size}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${r}</svg>`;
  }
  function noisy(colors, seed, top) {
    const rand = rng(seed); const g = [];
    for (let y = 0; y < 8; y++) {
      const row = [];
      for (let x = 0; x < 8; x++) {
        if (top && (y < 2 || (y === 2 && rand() > 0.5))) row.push('t' + Math.floor(rand() * 3));
        else row.push(String(Math.floor(rand() * colors)));
      }
      g.push(row);
    }
    return g;
  }
  const BLOCKS = {
    grass: () => svg(noisy(3, 7, true), { 0: '#8b5a2b', 1: '#6f4520', 2: '#a06a38', t0: '#5fa83a', t1: '#4c8f2c', t2: '#74c046' }),
    stone: () => svg(noisy(3, 11), { 0: '#8a8a8a', 1: '#6f6f6f', 2: '#9d9d9d' }),
    diamond: () => { const g = noisy(3, 19); [[1,2],[2,5],[4,1],[5,4],[6,6],[3,3]].forEach(([x,y]) => { g[y][x] = 'd'; if (g[y][x+1]) g[y][x+1] = 'e'; }); return svg(g, { 0: '#8a8a8a', 1: '#6f6f6f', 2: '#9d9d9d', d: '#5decf5', e: '#2bb7c4' }); },
    gold: () => { const g = noisy(3, 23); [[1,1],[5,2],[2,5],[6,5],[4,4]].forEach(([x,y]) => { g[y][x] = 'd'; if (g[y+1]) g[y+1][x] = 'e'; }); return svg(g, { 0: '#8a8a8a', 1: '#6f6f6f', 2: '#9d9d9d', d: '#ffe14d', e: '#d9a520' }); },
    tnt: () => svg([
      'rrRrrRrr', 'rRrrRrrR', 'wwwwwwww', 'wkwkwwkw', 'wkkkwkkw', 'wwwwwwww', 'rRrrRrrR', 'rrRrrRrr'].map(s => s.split('')), { r: '#c63a2b', R: '#a52a1e', w: '#efe6da', k: '#222' }),
    obsidian: () => svg(noisy(3, 31), { 0: '#1b1028', 1: '#2c1a44', 2: '#3f2766' }),
    netherrack: () => svg(noisy(3, 41), { 0: '#7a2a2a', 1: '#5c1e1e', 2: '#933636' }),
    amethyst: () => svg(noisy(3, 53), { 0: '#9a5cc6', 1: '#7a3fae', 2: '#c18df0' }),
  };
  // P1xel Lab logo: a pixel flask bubbling with color
  const FLASK = [
    '....kkkk....', '....kwwk....', '....kwwk....', '....kwwk....', '...kwwwwk...', '..kwwwwwwk..',
    '.kppppcpppk.', '.kpcpppppck.', 'kppppppcpppk', 'kpppcppppppk', 'kppppppppcpk', '.kkkkkkkkkk.'];
  const flask = size => svg(FLASK.map(s => s.split('')), { k: '#1a1030', w: '#d9d2ff', p: '#a24bff', c: '#36f0e0' }, size);
  // P1xel Lab logo: a glowing purple-to-cyan block with "P1" on the front and a sparkle
  function logo(size) {
    const N = 16, px = [];
    const P = ['XXX.', 'X..X', 'X..X', 'XXX.', 'X...', 'X...', 'X...'];
    const ONE = ['.X.', 'XX.', '.X.', '.X.', '.X.', '.X.', 'XXX'];
    const mix = (a, b, t) => '#' + [0, 2, 4].map(i => Math.round(parseInt(a.substr(i + 1, 2), 16) * (1 - t) + parseInt(b.substr(i + 1, 2), 16) * t).toString(16).padStart(2, '0')).join('');
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const corner = (x === 0 || x === N - 1) && (y === 0 || y === N - 1);
      if (corner) continue;
      let c;
      if (x === 0 || y === 0 || x === N - 1 || y === N - 1) c = '#120a24';                     // outline
      else {
        const t = Math.round(((x + y) / (2 * N)) * 6) / 6;                                     // stepped gradient
        c = t < 0.5 ? mix('#ff3fd2', '#8b2cff', t * 2) : mix('#8b2cff', '#14e0ff', (t - 0.5) * 2); // magenta → purple → cyan
        if (y === 1 || x === 1) c = mix(c, '#ffffff', 0.3);                                    // top-left shine
        if (y === N - 2 || x === N - 2) c = mix(c, '#12052e', 0.4);                             // bottom-right shade
      }
      px.push([x, y, c]);
    }
    const letter = (g, ox, oy) => g.forEach((row, j) => [...row].forEach((ch, i) => {
      if (ch !== 'X') return;
      px.push([ox + i + 1, oy + j + 1, '#1d0640']);                                             // drop shadow
    }));
    const letterTop = (g, ox, oy) => g.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === 'X') px.push([ox + i, oy + j, '#ffffff']); }));
    letter(P, 3, 4); letter(ONE, 9, 4); letterTop(P, 3, 4); letterTop(ONE, 9, 4);
    [[13, 2], [12, 3], [14, 3], [13, 4]].forEach(([x, y]) => px.push([x, y, '#fffbd0']));    // sparkle
    px.push([13, 3, '#ffffff']);
    const r = px.map(([x, y, c]) => `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${c}"/>`).join('');
    return `<svg viewBox="0 0 ${N} ${N}" width="${size}" height="${size}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">${r}</svg>`;
  }
  window.Pixels = { BLOCKS, block: (name, size = 40) => (BLOCKS[name] || BLOCKS.grass)().replace(/width="16" height="16"/, `width="${size}" height="${size}"`), flask, logo };
})();
