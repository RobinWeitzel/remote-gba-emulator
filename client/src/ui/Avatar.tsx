// Small avatar circle with the first initial of the player name, painted in
// a deterministic colour picked from an 8-swatch palette. Same name → same
// colour everywhere it appears, no auth required.

const PALETTE = [
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#f59e0b", // amber
  "#10b981", // emerald
  "#06b6d4", // cyan
  "#3b82f6", // blue
  "#ef4444", // red
  "#84cc16", // lime
];

function hash(str: string): number {
  // djb2-ish, sufficient for a stable index over a tiny palette
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

export function colorFor(name: string): string {
  const n = (name || "").trim() || "?";
  return PALETTE[hash(n.toLowerCase()) % PALETTE.length];
}

interface Props {
  name: string;
  size?: number;
  title?: string;
}

export function Avatar({ name, size = 24, title }: Props) {
  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  const bg = colorFor(name);
  // Slight darkening at the bottom keeps it from looking like a flat
  // sticker; mixes into the surface so a row of avatars feels cohesive.
  const fontSize = Math.max(11, Math.round(size * 0.46));
  return (
    <span
      className="avatar"
      title={title || name || initial}
      style={{
        width: size,
        height: size,
        fontSize,
        background: `linear-gradient(160deg, ${bg} 0%, ${bg}cc 100%)`,
        boxShadow: "inset 0 -1px 0 rgba(0,0,0,0.25)",
      }}
      aria-label={name}
    >
      {initial}
    </span>
  );
}
