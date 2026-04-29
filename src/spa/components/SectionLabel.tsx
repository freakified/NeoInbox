import s from "./SectionLabel.module.css";

export const SectionLabel = ({ children }: { children: React.ReactNode }) => {
  return <div className={s.label}>{children}</div>;
};
