// World layout of the cluster tower. The record core sits one floor below the ROUTE ring, so
// every query visibly pulls its facts up from it; each later tier is a smaller ring higher up,
// so the search narrows from the whole record to one conclusion. Each tier belongs to a phase.
export const TIERS = [
  {tier: 0, y: -4.5, ring: 0, phase: "PARSE", label: "DSL record", sub: "Entity · Fact · Goal"},
  {tier: 1, y: 0, ring: 13, phase: "ROUTE", label: "ROUTE access", sub: "one cloud per query"},
  {tier: 2, y: 6.5, ring: 4.5, phase: "ROUTE", label: "Suspect windows", sub: "route_cases"},
  {tier: 3, y: 11.5, ring: 3.2, phase: "TRACE", label: "TRACE lanes", sub: "assigned questions, SQL"},
  {tier: 4, y: 15.5, ring: 2.2, phase: "TRACE", label: "Candidates", sub: "assess"},
  {tier: 5, y: 19, ring: 0, phase: "SUBMIT", label: "Conclusion", sub: "SUBMIT root"},
];

// Cloud radius grows with the cube root of its size, like a ball of packed points.
export const cloudRadius = n => n <= 1 ? 0.22 : 0.26 * Math.cbrt(n) + 0.18;

export function layoutClusters({clusters}) {
  const pos = new Map(), radius = new Map(), angle = new Map();
  for (const t of TIERS) {
    const members = clusters.filter(c => c.tier === t.tier);
    members.forEach((c, k) => {
      // Ring order follows call order, starting at the front (+z) and turning clockwise.
      const a = members.length === 1 && !t.ring ? 0 : Math.PI / 2 - (k / members.length) * Math.PI * 2;
      angle.set(c.id, a);
      const r = members.length === 1 && t.tier > 1 ? 0 : t.ring;
      pos.set(c.id, [r * Math.cos(a), t.y, r * Math.sin(a)]);
      radius.set(c.id, c.kind === "core" ? 0.34 * Math.cbrt(c.fids.length) + 0.3 : cloudRadius(c.fids.length));
    });
  }
  const shape = new Map(clusters.map(c => [c.id, relaxCloud(c)]));
  return {pos, radius, angle, shape, top: TIERS[TIERS.length - 1].y, bottom: TIERS[0].y};
}

// A cloud's inner shape: a short Fruchterman–Reingold relaxation of its facts and entity hubs
// in the unit ball. Facts start at their ball sample and hubs at the mean of their facts;
// spokes and threads pull, every pair pushes, a weak pull to the centre keeps the ball round,
// and the agent hub stays pinned in the middle. Fixed iterations, so every reload agrees.
// Returns unit-ball positions (facts by fid, hubs by index), or null for a cloud with no ties.
const RELAX_STEPS = 90;
export function relaxCloud(c) {
  const {hubs, spokes, threads} = c.structure || {};
  if (!spokes?.length && !threads?.length) return null;
  const n = c.fids.length, N = n + hubs.length;
  const at = new Map(c.fids.map((fid, k) => [fid, k]));
  const P = new Float64Array(N * 3), D = new Float64Array(N * 3);
  c.fids.forEach((_, k) => P.set(ballPoint(k), k * 3));
  hubs.forEach((h, j) => {
    for (const fid of h.fids) for (let i = 0; i < 3; i++) P[(n + j) * 3 + i] += P[at.get(fid) * 3 + i] / h.fids.length;
  });
  const pinned = new Uint8Array(N);
  hubs.forEach((h, j) => { if (h.key.startsWith("agent:")) { pinned[n + j] = 1; P.fill(0, (n + j) * 3, (n + j) * 3 + 3); } });
  const edges = [...spokes.map(([fid, j]) => [at.get(fid), n + j, 1]),
                 ...threads.map(([a, b]) => [at.get(a), at.get(b), 1.6])];
  const L = Math.cbrt(4.19 / N), L2 = L * L;   // ideal spacing: the ball's volume shared out
  let temp = 0.12;
  for (let step = 0; step < RELAX_STEPS; step++) {
    D.fill(0);
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      const dx = P[i * 3] - P[j * 3], dy = P[i * 3 + 1] - P[j * 3 + 1], dz = P[i * 3 + 2] - P[j * 3 + 2];
      const r2 = dx * dx + dy * dy + dz * dz + 1e-6;
      if (r2 > 9 * L2) continue;
      const f = L2 / r2;              // |F| = L²/r, along d/r
      D[i * 3] += dx * f; D[i * 3 + 1] += dy * f; D[i * 3 + 2] += dz * f;
      D[j * 3] -= dx * f; D[j * 3 + 1] -= dy * f; D[j * 3 + 2] -= dz * f;
    }
    for (const [a, b, w] of edges) {
      const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2];
      const f = w * Math.sqrt(dx * dx + dy * dy + dz * dz) / L;   // |F| = r²/L, along d/r
      D[a * 3] -= dx * f; D[a * 3 + 1] -= dy * f; D[a * 3 + 2] -= dz * f;
      D[b * 3] += dx * f; D[b * 3 + 1] += dy * f; D[b * 3 + 2] += dz * f;
    }
    for (let i = 0; i < N; i++) {
      if (pinned[i]) continue;
      for (let k = 0; k < 3; k++) D[i * 3 + k] -= P[i * 3 + k] * 0.6;
      const len = Math.hypot(D[i * 3], D[i * 3 + 1], D[i * 3 + 2]) || 1e-9, s = Math.min(len, temp) / len;
      for (let k = 0; k < 3; k++) P[i * 3 + k] += D[i * 3 + k] * s;
    }
    temp *= 0.96;
  }
  // Back into the unit ball: the farthest point lands on the rim.
  let far = 1e-6;
  for (let i = 0; i < N; i++) far = Math.max(far, Math.hypot(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]));
  const unit = i => [P[i * 3] / far, P[i * 3 + 1] / far, P[i * 3 + 2] / far];
  return {fact: new Map(c.fids.map((fid, k) => [fid, unit(k)])), hub: hubs.map((_, j) => unit(n + j))};
}

// Unit-ball sample i: the R3 low-discrepancy sequence (three independent golden-like strides)
// mapped to radius, height and angle, so a cloud fills its ball evenly and every point keeps
// its place between reloads.
const R3 = [0.8191725134, 0.6710436067, 0.5497004779];
export function ballPoint(i) {
  const [u, v, w] = R3.map(a => (0.5 + i * a) % 1);
  const r = Math.cbrt(u), y = 1 - 2 * v, s = Math.sqrt(Math.max(0, 1 - y * y)), a = w * Math.PI * 2;
  return [r * s * Math.cos(a), r * y, r * s * Math.sin(a)];
}
