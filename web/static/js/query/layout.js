// World layout of the cluster tower: a cone. Floors sit at an even pitch and each floor's plate
// is a fixed size that shrinks toward the top, whatever the number of clouds on it, so the
// outline reads as the search narrowing from the whole record to one conclusion. The record
// core is the base; ROUTE queries climb a helix in call order. Each tier belongs to a phase.
// A floor's height is its index k times the pitch; a cone lying on its side (a landscape
// canvas) gets a longer pitch so it fills the width.
export const PITCH = {upright: 5, lying: 8};
export const TIERS = [
  {tier: 0, k: -1, plate: 8.6, ring: 0, phase: "PARSE", label: "DSL record", sub: "Entity · Fact · Goal"},
  {tier: 1, k: 0, plate: 8.2, ring: 6.6, rise: 2.6, phase: "ROUTE", label: "ROUTE access", sub: "one cloud per query"},
  {tier: 2, k: 1, plate: 6.2, ring: 4.4, phase: "ROUTE", label: "Suspect windows", sub: "route_cases"},
  {tier: 3, k: 2, plate: 4.6, ring: 3.1, phase: "TRACE", label: "TRACE lanes", sub: "assigned questions, SQL"},
  {tier: 4, k: 3, plate: 3.2, ring: 2, phase: "TRACE", label: "Candidates", sub: "assess"},
  {tier: 5, k: 4, plate: 2, ring: 0, phase: "SUBMIT", label: "Conclusion", sub: "SUBMIT root"},
];

// Cloud radius grows with the cube root of its size, like a ball of packed points.
export const cloudRadius = n => n <= 1 ? 0.22 : 0.26 * Math.cbrt(n) + 0.18;
// On the tower a cloud stays between these bounds, so a one-fact cloud and the record differ
// by about 4x, not 10x; the core is the base and may reach the top bound of its own.
const clampR = (r, lo, hi) => Math.max(lo, Math.min(hi, r));
const towerRadius = c => c.kind === "core" ? clampR(0.34 * Math.cbrt(c.fids.length) + 0.3, 1, 2)
  : clampR(cloudRadius(c.fids.length), 0.45, 1.15);

// Lays the clouds out at a pitch; relayout(pitch) moves them in place (the stage calls it when
// the canvas turns between portrait and landscape, and the points glide to their new seats).
export function layoutClusters({clusters}) {
  const pos = new Map(), radius = new Map(), angle = new Map();
  const shape = new Map(clusters.map(c => [c.id, relaxCloud(c)]));
  const layout = {pos, radius, angle, shape, top: 0, bottom: 0, pitch: 0, relayout};
  function relayout(pitch) {
    layout.pitch = pitch;
    for (const t of TIERS) t.y = t.k * pitch;
    place();
    layout.top = TIERS[TIERS.length - 1].y; layout.bottom = TIERS[0].y;
  }
  relayout(PITCH.upright);
  return layout;

  function place() {
    for (const t of TIERS) {
      const members = clusters.filter(c => c.tier === t.tier);
      members.forEach((c, k) => {
        // Ring order follows call order, starting at the front (+z) and turning clockwise; on a
        // floor with a rise each call also sits a little higher than the one before.
        const a = members.length === 1 && !t.ring ? 0 : Math.PI / 2 - (k / members.length) * Math.PI * 2;
        angle.set(c.id, a);
        const r = members.length === 1 && t.tier > 1 ? 0 : t.ring;
        const y = t.y + (t.rise && members.length > 1 ? t.rise * k / (members.length - 1) : 0);
        pos.set(c.id, [r * Math.cos(a), y, r * Math.sin(a)]);
        radius.set(c.id, towerRadius(c));
      });
    }
  }
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
