import { solve, compare } from './core.js';
self.onmessage = ({ data }) => {
  try {
    const start = performance.now(),
      results = data.compare
        ? compare(data.scene, data.settings)
        : [solve(data.scene, data.settings)];
    self.postMessage({ results, milliseconds: performance.now() - start });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
