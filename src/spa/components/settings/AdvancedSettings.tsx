import { useMailStore } from "../../../store/mailStore";
import { Icon } from "../Icon";
import { ArchiveImportSection } from "./ArchiveSettings";
import s from "../BundleManagerModal.module.css";

export const AdvancedSettings = () => {
  const reclassify = useMailStore((st) => st.reclassify);
  const reclassifying = useMailStore((st) => st.reclassifying);
  return (
    <div className={s.editor}>
      <div className={s.editorHeader}>
        <Icon name="tune" className={s.editorIcon} />
        <h3 className={s.editorTitle}>Advanced</h3>
      </div>
      <section className={s.section}>
        <h4 className={s.sectionTitle}>Reclassify inbox</h4>
        <p className={s.helpText}>Re-run all rules on mail already in your inbox.</p>
        <button
          type="button"
          className={s.primaryBtn}
          disabled={reclassifying}
          onClick={() => reclassify()}
        >
          {reclassifying ? "Reclassifying…" : "Reclassify inbox"}
        </button>
      </section>
      <ArchiveImportSection />
    </div>
  );
};
