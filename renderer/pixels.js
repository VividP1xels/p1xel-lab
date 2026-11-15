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
  window.Pixels = { BLOCKS, block: (name, size = 40) => (BLOCKS[name] || BLOCKS.grass)().replace(/width="16" height="16"/, `width="${size}" height="${size}"`), flask };
})();
