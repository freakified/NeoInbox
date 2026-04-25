export const Icon = ({
  name,
  className = "",
  style,
}: {
  name: string;
  className?: string;
  style?: React.CSSProperties;
}) => (
  <span className={`material-icons select-none ${className}`} style={style} aria-hidden="true">
    {name}
  </span>
);
