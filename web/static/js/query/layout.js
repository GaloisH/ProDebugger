// World layout of the cluster tower. The core sits at the origin with the ROUTE accesses on
// a ring around it; each later tier is a smaller ring higher up, so the search visibly
// narrows from the whole record to one conclusion.
export const TIERS = [
  {tier: 0, y: 0, ring: 0, label: "DSL record", sub: "Entity · Fact · Goal"},
  {tier: 1, y: 0, ring: 13, label: "ROUTE access", sub: "one cloud per query"},
  {tier: 2, y: 6.5, ring: 4.5, label: "Suspect windows", sub: "route_cases"},
  {tier: 3, y: 11.5, ring: 3.2, label: "TRACE lanes", sub: "SQL evidence"},
  {tier: 4, y: 15.5, ring: 2.2, label: "Candidates", sub: "assess"},
  {tier: 5, y: 19, ring: 0, label: "Conclusion", sub: "SUBMIT root"},
];

// Cloud radius grows with the cube root of its size, like a ball of packed points.
export const cloudRadius = n => n <= 1 ? 0.25 : 0.32 * Math.cbrt(n) + 0.25;

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
      radius.set(c.id, c.kind === "core" ? 0.42 * Math.cbrt(c.fids.length) + 0.4 : cloudRadius(c.fids.length));
    });
  }
  return {pos, radius, angle, top: TIERS[TIERS.length - 1].y};
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
