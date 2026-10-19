import { Icon } from "../Icon";
import { OpenModeSection } from "./OpenModeSettings";
import { TranslationSection } from "./TranslationSettings";
import s from "../BundleManagerModal.module.css";

export const GeneralSettings = () => (
  <div className={s.editor}>
    <div className={s.editorHeader}>
      <Icon name="settings" className={s.editorIcon} />
      <h3 className={s.editorTitle}>General</h3>
    </div>
    <OpenModeSection />
    <TranslationSection />
  </div>
);
