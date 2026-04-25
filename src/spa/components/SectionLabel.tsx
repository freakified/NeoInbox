export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-semibold text-neutral-400 uppercase tracking-wide mb-2 px-1">
      {children}
    </div>
  );
}
