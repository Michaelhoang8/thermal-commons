import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validate,
  assemble,
  solve,
  compare,
  residual,
  gridCSV,
  example,
  DEFAULT_SETTINGS,
} from '../core.js';
const settings = { ...DEFAULT_SETTINGS, tolerance: 1e-6, maxIterations: 5000 };
const near = (a, b, tol = 1e-5) => assert.ok(Math.abs(a - b) < tol, `${a} differs from ${b}`);
function direct(scene) {
  const { values, fixed, source, h } = assemble(scene),
    n = scene.size,
    unknown = [];
  for (let i = 0; i < values.length; i++) if (!fixed[i]) unknown.push(i);
  const positions = new Map(unknown.map((id, i) => [id, i])),
    a = unknown.map((id, row) => {
      const coefficients = Array(unknown.length + 1).fill(0);
      coefficients[row] = 4;
      coefficients[unknown.length] = h * h * source[id];
      for (const neighbor of [id - 1, id + 1, id - n, id + n])
        if (fixed[neighbor]) coefficients[unknown.length] += values[neighbor];
        else coefficients[positions.get(neighbor)] -= 1;
      return coefficients;
    });
  for (let k = 0; k < a.length; k++) {
    let pivot = k;
    for (let i = k + 1; i < a.length; i++) if (Math.abs(a[i][k]) > Math.abs(a[pivot][k])) pivot = i;
    [a[k], a[pivot]] = [a[pivot], a[k]];
    for (let i = k + 1; i < a.length; i++) {
      const factor = a[i][k] / a[k][k];
      for (let j = k; j <= a.length; j++) a[i][j] -= factor * a[k][j];
    }
  }
  const answer = Array(a.length).fill(0);
  for (let i = a.length - 1; i >= 0; i--) {
    let rhs = a[i][a.length];
    for (let j = i + 1; j < a.length; j++) rhs -= a[i][j] * answer[j];
    answer[i] = rhs / a[i][i];
  }
  unknown.forEach((id, i) => (values[id] = answer[i]));
  return values;
}
test('uniform Dirichlet data is solved without a sweep', () => {
  const s = example();
  s.boundary = { top: 37, right: 37, bottom: 37, left: 37 };
  const r = solve(s, settings);
  assert.equal(r.iterations, 0);
  assert.equal(r.residual, 0);
  assert.ok(r.values.every((v) => v === 37));
});
test('corners average adjacent edge values and fixed pins never move', () => {
  const s = example('wall', 9);
  s.pins = [{ x: 4, y: 4, temperature: 150 }];
  const r = solve(s, settings);
  assert.equal(r.values[0], 50);
  assert.equal(r.values[8], 50);
  assert.equal(r.values[80], 0);
  assert.equal(r.values[40], 150);
  assert.equal(r.fixed[40], 1);
});
test('all three iterative methods agree with independent dense elimination', () => {
  for (const kind of ['wall', 'source', 'pin']) {
    const s = example(kind, 7),
      expected = direct(s);
    for (const r of compare(s, settings)) {
      assert.equal(r.converged, true);
      for (let i = 0; i < expected.length; i++) near(r.values[i], expected[i]);
    }
  }
});
test('manufactured quadratic solution is reproduced by the discrete Poisson stencil', () => {
  const n = 9,
    s = example('wall', n);
  s.boundary = { top: 0, right: 0, bottom: 0, left: 0 };
  for (let y = 1; y < n - 1; y++)
    for (let x = 1; x < n - 1; x++) {
      const a = x / (n - 1),
        b = y / (n - 1);
      s.sources.push({ x, y, strength: 200 * (a * (1 - a) + b * (1 - b)) });
    }
  const r = solve(s, settings);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const a = x / (n - 1),
        b = y / (n - 1);
      near(r.values[y * n + x], 100 * a * (1 - a) * b * (1 - b), 1e-7);
    }
});
test('SOR omega one is exactly Gauss-Seidel', () => {
  const s = example('source', 11),
    a = solve(s, { ...settings, method: 'gs' }),
    b = solve(s, { ...settings, method: 'sor', omega: 1 });
  assert.deepEqual(a.values, b.values);
  assert.deepEqual(a.history, b.history);
});
test('Jacobi preserves reflection symmetry for symmetric boundary conditions', () => {
  const r = solve(example('wall', 15), { ...settings, method: 'jacobi' }),
    n = 15;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) near(r.values[y * n + x], r.values[y * n + n - 1 - x], 1e-10);
});
test('zero-source converged fields respect fixed-value extrema', () => {
  const s = example('pin', 17),
    r = solve(s, settings);
  assert.equal(r.converged, true);
  assert.ok(r.min >= -1e-5);
  assert.ok(r.max <= 150 + 1e-5);
});
test('iteration cap is reported as unconverged rather than a successful solution', () => {
  const r = solve(example(), { ...settings, maxIterations: 1 });
  assert.equal(r.converged, false);
  assert.equal(r.iterations, 1);
  assert.equal(r.history.length, 2);
  assert.ok(r.residual > settings.tolerance);
});
test('reported residual equals an independently evaluated PDE defect', () => {
  const r = solve(example('source', 13), settings),
    n = 13,
    h = 1 / (n - 1);
  let maximum = 0;
  for (let y = 1; y < n - 1; y++)
    for (let x = 1; x < n - 1; x++) {
      const i = y * n + x;
      const lap =
        (r.values[i - 1] - 2 * r.values[i] + r.values[i + 1]) / (h * h) +
        (r.values[i - n] - 2 * r.values[i] + r.values[i + n]) / (h * h);
      maximum = Math.max(maximum, Math.abs(-lap - r.source[i]));
    }
  near(r.residual, maximum, 1e-9);
  assert.ok(maximum <= settings.tolerance + 1e-9);
  assert.equal(residual(r.values, r.fixed, r.source, n), r.residual);
});
test('validation rejects overlapping painted cells, nonfinite values, and unbounded work', () => {
  const s = example();
  for (const change of [
    { size: 42 },
    { size: 5.5 },
    { source: NaN },
    { pins: [{ x: 0, y: 2, temperature: 20 }] },
    { pins: [{ x: 2, y: 2, temperature: 20 }], sources: [{ x: 2, y: 2, strength: 5 }] },
    { extra: 1 },
  ])
    assert.throws(() => validate({ ...s, ...change }, settings));
  for (const change of [
    { omega: 2 },
    { method: 'unknown' },
    { maxIterations: 5001 },
    { tolerance: 0 },
  ])
    assert.throws(() => validate(s, { ...settings, ...change }));
  assert.throws(() =>
    validate({ ...s, source: 9000, sources: [{ x: 2, y: 2, strength: 2000 }] }, settings),
  );
});
test('solutions are deterministic, inputs remain immutable, and CSV has every grid node', () => {
  const s = example('pin', 9),
    copy = structuredClone(s),
    a = solve(s, settings),
    b = solve(s, settings);
  assert.deepEqual(a, b);
  assert.deepEqual(s, copy);
  const csv = gridCSV(a).trim().split('\r\n');
  assert.equal(csv.length, 82);
  const row = csv[41].split(',');
  assert.equal(row[0], '4');
  assert.equal(row[1], '4');
  assert.equal(row[4], '150');
  assert.equal(row[5], '1');
});
