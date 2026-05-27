// Tiny inline SVG icons — kept here so the JSX in pages stays clean and we
// don't pull in an icon library. All icons stroke `currentColor`, so they
// tint by font color in context.

import type { CSSProperties } from "react";

interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
  style?: CSSProperties;
}

const baseProps = (size: number, sw: number, style?: CSSProperties) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: sw,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  style,
});

export function IconGamepad({ size = 16, strokeWidth = 1.8, className, style }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, style)} className={className}>
      <rect x="2" y="7" width="20" height="11" rx="3" />
      <line x1="7" y1="11" x2="7" y2="14" />
      <line x1="5.5" y1="12.5" x2="8.5" y2="12.5" />
      <circle cx="16" cy="11.5" r="0.9" />
      <circle cx="18" cy="13.5" r="0.9" />
    </svg>
  );
}

export function IconUsers({ size = 16, strokeWidth = 1.8, className, style }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, style)} className={className}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function IconShare({ size = 16, strokeWidth = 1.8, className, style }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, style)} className={className}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" />
      <line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
    </svg>
  );
}

export function IconPlay({ size = 16, strokeWidth = 1.8, className, style }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, style)} className={className}>
      <polygon points="6 4 20 12 6 20 6 4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconPlus({ size = 16, strokeWidth = 2, className, style }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, style)} className={className}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

export function IconBookmark({ size = 16, strokeWidth = 1.8, className, style }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, style)} className={className}>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function IconSettings({ size = 16, strokeWidth = 1.8, className, style }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, style)} className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

export function IconMuted({ size = 16, strokeWidth = 1.8, className, style }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, style)} className={className}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <line x1="23" y1="9" x2="17" y2="15" />
      <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
  );
}
export function IconUnmuted({ size = 16, strokeWidth = 1.8, className, style }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, style)} className={className}>
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19 5a9 9 0 0 1 0 14" />
    </svg>
  );
}

export function IconBack({ size = 16, strokeWidth = 2, className, style }: IconProps) {
  return (
    <svg {...baseProps(size, strokeWidth, style)} className={className}>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}
