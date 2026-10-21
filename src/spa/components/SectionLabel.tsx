import s from "./SectionLabel.module.css";

export const SectionLabel = ({ id, children }: { id?: string; children: React.ReactNode }) => {
  return <h2 id={id} className={s.label}>{children}</h2>;
};
