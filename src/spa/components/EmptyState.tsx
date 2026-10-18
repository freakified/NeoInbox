import type { ReactNode } from "react";
import { Icon } from "./Icon";
import s from "./EmptyState.module.css";

/**
 * What a view shows with nothing in it: Inbox's big centred icon with a line
 * of text under it, or for an empty inbox its sunny "Inbox zero" sky.
 */
export const EmptyState = ({
  icon,
  color,
  title,
  hint,
  children,
}: {
  icon: string;
  color?: string;
  title: string;
  hint?: string;
  /** Shown under the text, e.g. an offer to bring in older mail. */
  children?: ReactNode;
}) => (
  <div className={s.root}>
    <Icon name={icon} className={s.icon} style={color ? { color } : undefined} />
    <p className={s.title}>{title}</p>
    {hint && <p className={s.hint}>{hint}</p>}
    {children && <div className={s.extra}>{children}</div>}
  </div>
);

export const InboxZero = () => (
  <>
    <div className={s.sky} aria-hidden="true" />
    <div className={s.root} role="img" aria-label="You're all done">
      <SunArt className={s.sun} />
    </div>
  </>
);

/** The sun-and-clouds illustration, drawn here rather than copied. */
const SunArt = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 220 170" aria-hidden="true">
    <defs>
      {/* The lower-right half of the sun's points sits in shadow. */}
      <clipPath id="inbox-zero-shade">
        <path d="M60 -60 V60 H-60 Z" />
      </clipPath>
    </defs>

    <g className={s.cloudFar}>
      <Cloud x={8} y={42} scale={0.62} opacity={0.75} />
    </g>
    <g className={s.cloudNear}>
      <Cloud x={150} y={8} scale={0.48} opacity={0.6} />
    </g>

    <g transform="translate(115 105)">
      <rect x="-37" y="-37" width="74" height="74" fill="#f6c343" />
      <rect x="-37" y="-37" width="74" height="74" fill="#e8a93a" transform="rotate(45)" />
      <g clipPath="url(#inbox-zero-shade)">
        <rect x="-37" y="-37" width="74" height="74" fill="#d9a032" />
        <rect x="-37" y="-37" width="74" height="74" fill="#c58f2b" transform="rotate(45)" />
      </g>
      <circle r="34" fill="#fdd94a" />
      <path d="M-34 0 A34 34 0 0 1 24 -24 L-24 24 A34 34 0 0 1 -34 0 Z" fill="#ffe27a" />
    </g>

    <Cloud x={118} y={102} scale={0.82} />
  </svg>
);

const Cloud = ({
  x,
  y,
  scale,
  opacity = 1,
}: {
  x: number;
  y: number;
  scale: number;
  opacity?: number;
}) => (
  <g transform={`translate(${x} ${y}) scale(${scale})`} fill="#fff" opacity={opacity}>
    <circle cx="26" cy="30" r="14" />
    <circle cx="46" cy="22" r="20" />
    <circle cx="66" cy="32" r="12" />
    <rect x="12" y="30" width="66" height="14" rx="7" />
  </g>
);
