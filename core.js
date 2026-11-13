export const METHODS = ['jacobi', 'gs', 'sor'];
function number(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw Error(`${label} must be a finite number from ${min} to ${max}.`);
  return value;
}
function keys(value, expected, label) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== expected.length ||
    expected.some((k) => !Object.hasOwn(value, k))
  )
    throw Error(`${label} needs ${expected.join(', ')} only.`);
}
export function validate(scene, settings) {
  keys(scene, ['size', 'boundary', 'source', 'pins', 'sources'], 'Scene');
  const n = number(scene.size, 5, 41, 'Grid size');
  if (!Number.isInteger(n)) throw Error('Grid size must be an integer.');
  keys(scene.boundary, ['top', 'right', 'bottom', 'left'], 'Boundary');
  for (const value of Object.values(scene.boundary))
    number(value, -100, 500, 'Boundary temperature');
  number(scene.source, -10000, 10000, 'Background source');
  const occupied = new Set();
  for (const [name, field, min, max] of [
    ['pins', 'temperature', -100, 500],
    ['sources', 'strength', -10000, 10000],
  ]) {
    if (!Array.isArray(scene[name]) || scene[name].length > (n - 2) ** 2)
      throw Error(`Too many ${name}.`);
    for (const item of scene[name]) {
      keys(item, ['x', 'y', field], name);
      for (const key of ['x', 'y'])
        if (!Number.isInteger(item[key]) || item[key] < 1 || item[key] > n - 2)
          throw Error('Painted cells must lie strictly inside the grid.');
      number(item[field], min, max, field);
      const id = item.y * n + item.x;
      if (occupied.has(id)) throw Error('Each painted cell may contain one pin or source only.');
      occupied.add(id);
      if (name === 'sources')
        number(scene.source + item.strength, -10000, 10000, 'Combined source');
    }
  }
  keys(settings, ['method', 'omega', 'tolerance', 'maxIterations'], 'Settings');
  if (!METHODS.includes(settings.method)) throw Error('Unknown solver method.');
  number(settings.omega, 0.1, 1.95, 'SOR omega');
  number(settings.tolerance, 1e-6, 1, 'Residual tolerance');
  number(settings.maxIterations, 1, 5000, 'Iteration limit');
  if (!Number.isInteger(settings.maxIterations)) throw Error('Iteration limit must be an integer.');
  return { scene: structuredClone(scene), settings: { ...settings } };
}
export function assemble(scene) {
  const n = scene.size,
    values = new Float64Array(n * n).fill(
      Object.values(scene.boundary).reduce((a, b) => a + b, 0) / 4,
    ),
    fixed = new Uint8Array(n * n),
    source = new Float64Array(n * n).fill(scene.source),
    b = scene.boundary;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const sides = [];
      if (y === 0) sides.push(b.top);
      if (y === n - 1) sides.push(b.bottom);
      if (x === 0) sides.push(b.left);
      if (x === n - 1) sides.push(b.right);
      if (sides.length) {
        const i = y * n + x;
        fixed[i] = 1;
        values[i] = sides.reduce((a, b) => a + b, 0) / sides.length;
        source[i] = 0;
      }
    }
  for (const pin of scene.pins) {
    const i = pin.y * n + pin.x;
    fixed[i] = 1;
    values[i] = pin.temperature;
    source[i] = 0;
  }
  for (const patch of scene.sources) source[patch.y * n + patch.x] += patch.strength;
  return { values, fixed, source, h: 1 / (n - 1) };
}
export function residual(values, fixed, source, n) {
  const h2 = 1 / (n - 1) ** 2;
  let maximum = 0;
  for (let y = 1; y < n - 1; y++)
    for (let x = 1; x < n - 1; x++) {
      const i = y * n + x;
      if (!fixed[i])
        maximum = Math.max(
          maximum,
          Math.abs(
            (4 * values[i] - values[i - 1] - values[i + 1] - values[i - n] - values[i + n]) / h2 -
              source[i],
          ),
        );
    }
  return maximum;
}
export function solve(scene, settings) {
  const clean = validate(scene, settings);
  scene = clean.scene;
  settings = clean.settings;
  const n = scene.size,
    { values: initial, fixed, source, h } = assemble(scene),
    h2 = h * h;
  let values = initial,
    buffer = initial.slice(),
    r = residual(values, fixed, source, n),
    iterations = 0,
    delta = 0;
  const history = [{ iteration: 0, residual: r, delta: 0 }];
  while (r > settings.tolerance && iterations < settings.maxIterations) {
    delta = 0;
    const next = settings.method === 'jacobi' ? buffer : values;
    for (let y = 1; y < n - 1; y++)
      for (let x = 1; x < n - 1; x++) {
        const i = y * n + x;
        if (fixed[i]) continue;
        const old = values[i],
          target =
            (values[i - 1] + values[i + 1] + values[i - n] + values[i + n] + h2 * source[i]) / 4,
          value = settings.method === 'sor' ? old + settings.omega * (target - old) : target;
        next[i] = value;
        delta = Math.max(delta, Math.abs(value - old));
      }
    if (settings.method === 'jacobi') [values, buffer] = [buffer, values];
    iterations++;
    r = residual(values, fixed, source, n);
    if (!Number.isFinite(r)) throw Error('Numerical iteration became nonfinite.');
    history.push({ iteration: iterations, residual: r, delta });
  }
  return {
    scene,
    settings,
    values,
    fixed,
    source,
    history,
    iterations,
    residual: r,
    delta,
    converged: r <= settings.tolerance,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}
export function compare(scene, settings) {
  return METHODS.map((method) => solve(scene, { ...settings, method }));
}
export function gridCSV(result) {
  const n = result.scene.size,
    rows = ['x,y,x_normalized,y_normalized,temperature,fixed,source'];
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      rows.push(
        [x, y, x / (n - 1), y / (n - 1), result.values[i], result.fixed[i], result.source[i]].join(
          ',',
        ),
      );
    }
  return rows.join('\r\n') + '\r\n';
}
export const DEFAULT_SETTINGS = {
  method: 'sor',
  omega: 1.6,
  tolerance: 0.001,
  maxIterations: 3000,
};
export function example(name = 'wall', size = 21) {
  const scene = {
    size,
    boundary: { top: 100, right: 0, bottom: 0, left: 0 },
    source: 0,
    pins: [],
    sources: [],
  };
  if (name === 'source') {
    scene.boundary = { top: 20, right: 20, bottom: 20, left: 20 };
    scene.source = 1000;
  } else if (name === 'pin') {
    scene.boundary = { top: 0, right: 0, bottom: 0, left: 0 };
    scene.pins = [{ x: Math.floor(size / 2), y: Math.floor(size / 2), temperature: 150 }];
  } else if (name !== 'wall') throw Error('Unknown example.');
  return scene;
}
