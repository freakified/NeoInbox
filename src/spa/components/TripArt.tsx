/**
 * The travel-bag illustration Inbox put on every trip (it never used
 * destination photos): a teal bag with a boarding pass and an orange luggage
 * tag. Drawn here rather than copied. "light" is the collapsed row's card,
 * "dark" the banner across an open trip.
 */
const PALETTES = {
  light: {
    bg: "#26c6da",
    shade: "#00acc1",
    bag: "#4dd0e1",
    bagEdge: "#0097a7",
    strap: "#00626b",
    ticket: "#b2ebf2",
    ticketBand: "#3f51b5",
    glyph: "#e0f7fa",
  },
  dark: {
    bg: "#0b4f56",
    shade: "#08393f",
    bag: "#11707a",
    bagEdge: "#0a4c53",
    strap: "#03272b",
    ticket: "#7fb7c4",
    ticketBand: "#283593",
    glyph: "#a9d3dc",
  },
};

export const TripArt = ({
  tone,
  className,
}: {
  tone: "light" | "dark";
  className?: string;
}) => {
  const p = PALETTES[tone];
  return (
    <svg
      className={className}
      viewBox="0 0 260 180"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <rect width="260" height="180" fill={p.bg} />
      <path d="M0 120 L120 0 H260 V30 L110 180 H0 Z" fill={p.shade} opacity="0.55" />
      {/* Bag body and its handle. */}
      <g transform="rotate(-18 120 110)">
        <path
          d="M78 56 q0 -34 42 -34 q42 0 42 34"
          fill="none"
          stroke={p.strap}
          strokeWidth="14"
          strokeLinecap="round"
        />
        <rect x="40" y="56" width="170" height="130" rx="22" fill={p.bagEdge} />
        <rect x="40" y="50" width="164" height="126" rx="22" fill={p.bag} />
        <rect x="52" y="64" width="140" height="6" rx="3" fill={p.bagEdge} opacity="0.5" />
      </g>
      {/* Boarding pass tucked in the front pocket. */}
      <g transform="rotate(-24 120 92)">
        <rect x="70" y="66" width="104" height="58" rx="5" fill={p.ticket} />
        <rect x="70" y="66" width="22" height="58" rx="5" fill={p.ticketBand} />
        <path
          d="M128 84 l18 8 l-18 8 l3 -8 z M120 92 h26"
          fill={p.glyph}
          stroke={p.glyph}
          strokeWidth="3"
          strokeLinejoin="round"
        />
        <rect x="104" y="108" width="54" height="4" rx="2" fill={p.glyph} />
      </g>
      {/* Luggage tag on its strap. */}
      <path
        d="M178 34 q34 18 22 70"
        fill="none"
        stroke={p.strap}
        strokeWidth="5"
        strokeLinecap="round"
      />
      <g transform="rotate(14 206 128)">
        <path d="M194 104 h24 v52 h-24 z M194 104 l12 -10 l12 10" fill="#f4511e" />
        <circle cx="206" cy="104" r="4" fill={p.strap} />
        <rect x="199" y="118" width="14" height="3" rx="1.5" fill="#ffccbc" />
        <rect x="199" y="126" width="14" height="3" rx="1.5" fill="#ffccbc" />
        <rect x="199" y="134" width="14" height="3" rx="1.5" fill="#ffccbc" />
      </g>
    </svg>
  );
};
