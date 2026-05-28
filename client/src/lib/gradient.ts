// Deterministic gradient from a name. Hash → two hues 30° apart.

function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function gradientForName(name: string): string {
  const h = hash32(name || "?");
  const hueA = h % 360;
  const hueB = (hueA + 35) % 360;
  return `linear-gradient(135deg, hsl(${hueA}, 50%, 22%) 0%, hsl(${hueB}, 60%, 14%) 100%)`;
}
