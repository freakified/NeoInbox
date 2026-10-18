import { useId } from "react";

/**
 * The package illustration on parcel cards, after Inbox's purchase
 * highlights: a closed yellow box, lid and label on top, centered on a pale
 * blue glow. Drawn here, like TripArt.
 */
export const ParcelArt = ({ className }: { className?: string }) => {
  // Gradient ids are document-global; every card on the page draws its own.
  const id = useId();
  return (
    <svg className={className} viewBox="0 0 260 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-glow`} cx="50%" cy="50%" r="70%">
          <stop offset="0" stopColor="#f3faff" />
          <stop offset="1" stopColor="#b3dff7" />
        </radialGradient>
        <linearGradient id={`${id}-front`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f8c34f" />
          <stop offset="1" stopColor="#efa92c" />
        </linearGradient>
      </defs>
      <rect width="260" height="180" fill={`url(#${id}-glow)`} />
      <g transform="translate(130 96) scale(1.2) translate(-130 -96)">
      <ellipse cx="130" cy="124" rx="56" ry="5" fill="#7fb6d6" opacity="0.35" />
      {/* Lid seen from just above, then the front face under its lip. */}
      <path d="M86 70 H174 L182 88 H78 Z" fill="#fcd77a" />
      <path d="M78 88 H182 V116 a6 6 0 0 1 -6 6 H84 a6 6 0 0 1 -6 -6 Z" fill={`url(#${id}-front)`} />
      <rect x="78" y="88" width="104" height="5" fill="#f6b938" />
      {/* Tape along the lid and the shipping label on its corner. */}
      <path d="M98 80 H150" stroke="#e9a93a" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M150 72.5 H164 L166 79 H151 Z" fill="#fffdf6" />
      </g>
    </svg>
  );
};
