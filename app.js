import { example, validate, assemble, gridCSV, DEFAULT_SETTINGS } from './core.js';
const $ = (id) => document.getElementById(id),
  names = { jacobi: 'Jacobi', gs: 'Gauss–Seidel', sor: 'SOR' },
  colors = { jacobi: '#4e8298', gs: '#a45b39', sor: '#706d3f' };
let scene = example(),
  results = [],
  selected = 0,
  worker = null,
  revision = 0;
function el(tag, text) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  return n;
}
function status(text) {
  $('status').textContent = text;
  $('settings-status').textContent = text;
}
function number(id) {
  if (!$(id).value.trim()) throw Error('Fill all numeric settings.');
  return Number($(id).value);
}
function settings() {
  return {
    method: $('method').value,
    omega: number('omega'),
    tolerance: number('tolerance'),
    maxIterations: number('limit'),
  };
}
function read() {
  const size = number('size'),
    candidate = {
      ...scene,
      size,
      boundary: Object.fromEntries(
        ['top', 'right', 'bottom', 'left'].map((key) => [key, number(key)]),
      ),
      source: number('background'),
    };
  if (size !== scene.size) {
    candidate.pins = [];
    candidate.sources = [];
  }
  const clean = validate(candidate, settings());
  scene = clean.scene;
  return clean;
}
function sync(config = DEFAULT_SETTINGS) {
  $('size').value = scene.size;
  for (const key of ['top', 'right', 'bottom', 'left']) $(key).value = scene.boundary[key];
  $('background').value = scene.source;
  $('method').value = config.method;
  $('omega').value = config.omega;
  $('tolerance').value = config.tolerance;
  $('limit').value = config.maxIterations;
  for (const id of ['x', 'y']) {
    $(id).max = scene.size - 1;
    $(id).value = Math.min(Number($(id).value), scene.size - 1);
  }
}
function invalidate() {
  revision++;
  worker?.terminate();
  worker = null;
  $('solve').disabled = $('compare').disabled = false;
  $('cancel').disabled = true;
  results = [];
  $('results').hidden = true;
}
function color(value, min, max) {
  const stops = [
      [40, 64, 90],
      [72, 140, 154],
      [229, 202, 131],
      [198, 96, 53],
      [101, 42, 42],
    ],
    t = max === min ? 0.5 : Math.max(0, Math.min(1, (value - min) / (max - min))),
    position = t * 4,
    index = Math.min(3, Math.floor(position)),
    fraction = position - index;
  return `rgb(${stops[index].map((v, c) => Math.round(v + (stops[index + 1][c] - v) * fraction)).join(',')})`;
}
function draw() {
  const current = results[selected],
    grid = current || assemble(scene),
    values = grid.values,
    n = scene.size,
    min = Math.min(...values),
    max = Math.max(...values),
    ctx = $('field').getContext('2d'),
    cell = 630 / n;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      ctx.fillStyle = color(values[i], min, max);
      ctx.fillRect(x * cell, y * cell, cell + 0.5, cell + 0.5);
    }
  ctx.strokeStyle = '#fff9ed';
  ctx.lineWidth = 1.5;
  for (const pin of scene.pins)
    ctx.strokeRect((pin.x + 0.2) * cell, (pin.y + 0.2) * cell, 0.6 * cell, 0.6 * cell);
  for (const patch of scene.sources) {
    ctx.fillStyle = '#fff9ed';
    ctx.beginPath();
    ctx.arc(
      (patch.x + 0.5) * cell,
      (patch.y + 0.5) * cell,
      Math.max(2, cell * 0.1),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  $('minimum').textContent = min.toFixed(2);
  $('maximum').textContent = max.toFixed(2);
  $('view-label').textContent = current
    ? `${names[current.settings.method]} · ${current.converged ? 'converged' : 'iteration limit'}`
    : 'Initial guess · unsolved';
  for (const id of ['x', 'y']) $(id).max = n - 1;
  inspect();
}
function inspect() {
  const x = Number($('x').value),
    y = Number($('y').value),
    n = scene.size;
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= n || y >= n) {
    $('probe').textContent = 'Select an integer coordinate inside the grid.';
    return;
  }
  const r = results[selected] || assemble(scene),
    i = y * n + x;
  $('probe').textContent =
    `(${x}, ${y}) · T ${r.values[i].toFixed(5)} · ${r.fixed[i] ? 'fixed temperature' : `source ${r.source[i].toFixed(2)}`} · ${results.length ? 'solved iterate' : 'initial guess'}`;
}
function cellTool() {
  try {
    const clean = read(),
      x = number('x'),
      y = number('y'),
      n = scene.size,
      tool = $('tool').value;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= n || y >= n)
      throw Error('Select an integer cell inside the grid.');
    if (tool === 'inspect') {
      inspect();
      return;
    }
    if (x === 0 || y === 0 || x === n - 1 || y === n - 1)
      throw Error('Use the boundary controls to edit edge cells.');
    const candidate = structuredClone(scene);
    candidate.pins = candidate.pins.filter((p) => p.x !== x || p.y !== y);
    candidate.sources = candidate.sources.filter((p) => p.x !== x || p.y !== y);
    if (tool === 'pin') candidate.pins.push({ x, y, temperature: number('paint-value') });
    if (tool === 'source') candidate.sources.push({ x, y, strength: number('paint-value') });
    scene = validate(candidate, clean.settings).scene;
    invalidate();
    draw();
    status('Cell updated. Solve again to compute the new field.');
  } catch (e) {
    status(e.message);
  }
}
function svg(tag, attrs, text) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (text !== undefined) n.textContent = text;
  return n;
}
function renderResults() {
  const chart = $('chart'),
    fragment = document.createDocumentFragment(),
    maxIterations = Math.max(1, ...results.map((r) => r.iterations)),
    all = results.flatMap((r) => r.history.map((h) => Math.max(h.residual, 1e-15))),
    low = Math.log10(Math.min(...all)),
    high = Math.max(low + 1, Math.log10(Math.max(...all))),
    px = (i) => 65 + (810 * i) / maxIterations,
    py = (r) => 205 - (170 * (Math.log10(Math.max(r, 1e-15)) - low)) / (high - low);
  for (let i = 0; i <= 4; i++) {
    const exponent = low + ((high - low) * i) / 4,
      y = 205 - (170 * i) / 4;
    fragment.append(
      svg('line', { x1: 65, x2: 875, y1: y, y2: y, stroke: '#dfccb8' }),
      svg('text', { x: 6, y: y + 3 }, `1e${exponent.toFixed(1)}`),
      svg('text', { x: 65 + (810 * i) / 4, y: 228 }, Math.round((maxIterations * i) / 4)),
    );
  }
  for (const r of results) {
    const stride = Math.max(1, Math.ceil(r.history.length / 500)),
      points = r.history
        .filter((_, i) => i % stride === 0 || i === r.history.length - 1)
        .map((h) => `${px(h.iteration)},${py(h.residual)}`)
        .join(' ');
    fragment.append(
      svg('polyline', {
        points,
        fill: 'none',
        stroke: colors[r.settings.method],
        'stroke-width': 2,
      }),
    );
  }
  chart.replaceChildren(fragment);
  $('summary').replaceChildren(
    ...results.map((r, index) => {
      const row = el('tr');
      row.className = r.settings.method;
      for (const value of [
        names[r.settings.method],
        r.iterations,
        r.residual.toExponential(3),
        r.converged ? 'Converged' : 'Iteration limit',
      ])
        row.append(el('td', value));
      const cell = el('td'),
        button = el('button', 'View field');
      button.addEventListener('click', () => {
        selected = index;
        draw();
      });
      cell.append(button);
      row.append(cell);
      return row;
    }),
  );
  $('results').hidden = false;
  draw();
}
function run(compare = false) {
  let input;
  try {
    input = read();
  } catch (e) {
    status(e.message);
    return;
  }
  invalidate();
  draw();
  const ticket = revision,
    current = new Worker('./worker.js', { type: 'module' });
  worker = current;
  $('solve').disabled = $('compare').disabled = true;
  $('cancel').disabled = false;
  status('Iterating the field…');
  current.onmessage = ({ data }) => {
    if (ticket !== revision) return;
    current.terminate();
    worker = null;
    $('solve').disabled = $('compare').disabled = false;
    $('cancel').disabled = true;
    if (data.error) {
      status(data.error);
      return;
    }
    results = data.results;
    selected = Math.max(
      0,
      results.findIndex((r) => r.settings.method === input.settings.method),
    );
    renderResults();
    status(
      `${results.filter((r) => r.converged).length} of ${results.length} methods met the residual tolerance · ${data.milliseconds.toFixed(1)} ms total. Colors rescale to each displayed field.`,
    );
  };
  current.onerror = () => {
    if (ticket !== revision) return;
    invalidate();
    status('Solver worker failed. Try again.');
  };
  current.postMessage({ ...input, compare });
}
for (const id of [
  'size',
  'top',
  'right',
  'bottom',
  'left',
  'background',
  'method',
  'omega',
  'tolerance',
  'limit',
])
  $(id).addEventListener('input', () => {
    invalidate();
    try {
      read();
      draw();
      status('Settings changed. Solve to update the field.');
    } catch (e) {
      status(e.message);
    }
  });
$('settings-open').addEventListener('click', () => {
  $('settings-status').textContent = '';
  $('settings-panel').showModal();
});
$('settings-close').addEventListener('click', () => $('settings-panel').close());
$('solve').addEventListener('click', () => run());
$('compare').addEventListener('click', () => run(true));
$('cancel').addEventListener('click', () => {
  invalidate();
  draw();
  status('Solve cancelled.');
});
$('cell').addEventListener('click', cellTool);
$('field').addEventListener('click', (event) => {
  const rect = $('field').getBoundingClientRect();
  $('x').value = Math.min(
    scene.size - 1,
    Math.floor(((event.clientX - rect.left) / rect.width) * scene.size),
  );
  $('y').value = Math.min(
    scene.size - 1,
    Math.floor(((event.clientY - rect.top) / rect.height) * scene.size),
  );
  cellTool();
});
$('example').addEventListener('change', () => {
  invalidate();
  scene = example($('example').value);
  sync();
  draw();
  run();
});
function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = el('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('save').addEventListener('click', () => {
  try {
    download('thermal-experiment.json', JSON.stringify(read(), null, 2));
  } catch (e) {
    status(e.message);
  }
});
$('csv').addEventListener('click', () =>
  download('thermal-field.csv', gridCSV(results[selected]), 'text/csv;charset=utf-8'),
);
$('report').addEventListener('click', () =>
  download(
    'thermal-analysis.json',
    JSON.stringify(
      {
        results: results.map((r) => ({
          ...r,
          values: [...r.values],
          fixed: [...r.fixed],
          source: [...r.source],
        })),
      },
      null,
      2,
    ),
  ),
);
$('import').addEventListener('change', async () => {
  const file = $('import').files[0];
  if (!file) return;
  invalidate();
  const ticket = revision;
  try {
    if (file.size > 300000) throw Error('Experiment files are limited to 300 KB.');
    const value = JSON.parse(await file.text());
    if (
      !value ||
      Object.keys(value).length !== 2 ||
      !Object.hasOwn(value, 'scene') ||
      !Object.hasOwn(value, 'settings')
    )
      throw Error('Experiment needs scene and settings only.');
    const clean = validate(value.scene, value.settings);
    if (ticket !== revision) return;
    scene = clean.scene;
    sync(clean.settings);
    draw();
    run();
  } catch (e) {
    if (ticket === revision) status(`Import rejected: ${e.message}`);
  } finally {
    $('import').value = '';
  }
});
sync();
draw();
run();
