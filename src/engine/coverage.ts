import type { TexturePlane } from './gpu';

// Statistical preparation only. The shader applies the resulting field.
export function coverageField(luminance: Float32Array, width: number, height: number): TexturePlane {
  const count = width * height, factor = Math.min(1, 48 / Math.max(width, height));
  const gw = Math.max(2, Math.round(width * factor)), gh = Math.max(2, Math.round(height * factor));
  const grid = new Float32Array(gw * gh);
  let foreground = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = luminance[y * width + x];
    if (value > 0.15) foreground++;
    const cell = Math.floor(y * gh / height) * gw + Math.floor(x * gw / width);
    grid[cell] = Math.max(grid[cell], value);
  }
  const axial = 1 / Math.hypot(gw, gh), diagonal = axial * Math.SQRT2;
  for (const direction of [1, -1]) {
    for (let row = 0; row < gh; row++) for (let column = 0; column < gw; column++) {
      const x = direction > 0 ? column : gw - 1 - column;
      const y = direction > 0 ? row : gh - 1 - row, cell = y * gw + x;
      let value = grid[cell];
      const previousX = x - direction, previousY = y - direction;
      if (previousX >= 0 && previousX < gw) value = Math.max(value, grid[y * gw + previousX] - axial);
      if (previousY >= 0 && previousY < gh) {
        for (let dx = -1; dx <= 1; dx++) {
          if (x + dx >= 0 && x + dx < gw) value = Math.max(value,
            grid[previousY * gw + x + dx] - (dx === 0 ? axial : diagonal));
        }
      }
      grid[cell] = value;
    }
  }
  let minimum = Infinity, maximum = -Infinity;
  for (const value of grid) { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
  const proximityScale = maximum > minimum ? 1 / (maximum - minimum) : 0;
  for (let i = 0; i < grid.length; i++) grid[i] -= minimum;
  const field = new Float32Array(count), weight = foreground < count * 0.2 ? 0.1 : 0.6;
  minimum = Infinity; maximum = -Infinity;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const gx = Math.max(0, Math.min(gw - 1, (x + 0.5) * gw / width - 0.5));
    const gy = Math.max(0, Math.min(gh - 1, (y + 0.5) * gh / height - 0.5));
    const x0 = Math.floor(gx), y0 = Math.floor(gy), x1 = Math.min(gw - 1, x0 + 1), y1 = Math.min(gh - 1, y0 + 1);
    const top = grid[y0 * gw + x0] + (grid[y0 * gw + x1] - grid[y0 * gw + x0]) * (gx - x0);
    const bottom = grid[y1 * gw + x0] + (grid[y1 * gw + x1] - grid[y1 * gw + x0]) * (gx - x0);
    const proximity = Math.fround((top + (bottom - top) * (gy - y0)) * proximityScale);
    const index = y * width + x, value = weight * luminance[index] + (1 - weight) * proximity;
    field[index] = value; minimum = Math.min(minimum, value); maximum = Math.max(maximum, value);
  }
  const scale = maximum > minimum ? 1 / (maximum - minimum) : 0;
  for (let i = 0; i < count; i++) field[i] = (field[i] - minimum) * scale;
  return { width, height, data: field };
}

export function coverageThreshold(field: TexturePlane, amount: number, softness = 0.03) {
  if (amount >= 1) return -2;
  if (amount <= 0) return 1 + softness;
  const histogram = new Uint32Array(1024);
  for (const value of field.data) histogram[Math.max(0, Math.min(1023, Math.floor(value * 1024)))]++;
  const target = amount * field.data.length;
  let lower = -softness, upper = 1 + softness;
  for (let iteration = 0; iteration < 24; iteration++) {
    const threshold = (lower + upper) / 2;
    let area = 0;
    for (let bin = 0; bin < 1024; bin++) {
      const t = Math.max(0, Math.min(1, ((bin + 0.5) / 1024 - threshold + softness) / softness));
      area += histogram[bin] * t * t * (3 - 2 * t);
    }
    if (area > target) lower = threshold; else upper = threshold;
  }
  return (lower + upper) / 2;
}
