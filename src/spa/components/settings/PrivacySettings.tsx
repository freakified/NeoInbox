import { Icon } from "../Icon";
import { RemoteImagesSection } from "./RemoteImagesSettings";
import s from "../BundleManagerModal.module.css";

export const PrivacySettings = () => (
  <div className={s.editor}>
    <div className={s.editorHeader}>
      <Icon name="shield" className={s.editorIcon} />
      <h3 className={s.editorTitle}>Privacy</h3>
    </div>
    <RemoteImagesSection />
  </div>
);
