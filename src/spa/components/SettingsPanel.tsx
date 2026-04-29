import { clsx } from "clsx";
import { useState } from "react";
import { CATEGORIES, getCategoryMeta } from "../../shared/categories";
import type { BuiltinCategory, CustomBundleRecord, CustomBundleRule } from "../../shared/types";
import { useMailStore, useCustomBundles, useOverrides } from "../../store/mailStore";
import { Icon } from "./Icon";
import s from "./SettingsPanel.module.css";

const BUNDLE_CATEGORIES = Object.entries(CATEGORIES)
  .filter(([cat]) => cat !== "personal")
  .sort(([, a], [, b]) => a.order - b.order)
  .map(([cat, meta]) => ({ cat: cat as BuiltinCategory, meta }));

const PRESET_COLORS = [
  "#4285F4", "#34A853", "#FBBC04", "#EA4335",
  "#FF6D01", "#9C27B0", "#00BCD4", "#795548",
];

const PRESET_ICONS = [
  "label", "star", "bookmark", "work", "school", "home",
  "favorite", "sports_esports", "music_note", "restaurant",
  "fitness_center", "local_library", "camera_alt", "pets",
  "shopping_bag", "flight", "account_balance", "notifications",
];

// ─── Built-in bundle customization ──────────────────────────────────────────

const BuiltinBundleRow = ({ cat }: { cat: BuiltinCategory }) => {
  const meta = CATEGORIES[cat];
  const overrides = useOverrides();
  const setOverride = useMailStore((st) => st.setOverride);
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState("");

  const added = overrides.filter((o) => o.category === cat).map((o) => o.senderDomain);

  const handleAdd = () => {
    const domain = adding.trim().toLowerCase().replace(/^@/, "");
    if (!domain) return;
    setOverride(domain, cat);
    setAdding("");
  };

  const handleRemove = (domain: string) => {
    setOverride(domain, null);
  };

  return (
    <div className={s.bundleCard}>
      <button
        className={s.bundleCardTrigger}
        onClick={() => setExpanded((v) => !v)}
      >
        <Icon name={meta.icon} className={s.bundleCardIcon} style={{ color: meta.color }} />
        <span className={s.bundleCardName} style={{ color: meta.color }}>
          {meta.name}
        </span>
        {added.length > 0 && (
          <span className={s.bundleCardCount}>{added.length} added</span>
        )}
        <Icon
          name={expanded ? "expand_less" : "expand_more"}
          className={s.bundleCardExpandIcon}
        />
      </button>

      {expanded && (
        <div className={s.expandedSection}>
          <p className={s.expandedDesc}>
            Emails from these domains are always routed to {meta.name}.
          </p>

          {added.length > 0 && (
            <div className={s.chipList}>
              {added.map((domain) => (
                <span key={domain} className={s.chip}>
                  {domain}
                  <button
                    onClick={() => handleRemove(domain)}
                    className={s.chipRemove}
                  >
                    <Icon name="close" className={s.chipRemoveIcon} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className={s.inputRow}>
            <input
              type="text"
              placeholder="example.com"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              className={s.textInput}
            />
            <button
              onClick={handleAdd}
              disabled={!adding.trim()}
              className={s.primaryBtn}
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Custom bundle editor ────────────────────────────────────────────────────

interface BundleFormState {
  id: string;
  name: string;
  color: string;
  icon: string;
  rules: CustomBundleRule[];
}

const emptyForm = (): BundleFormState => ({
  id: crypto.randomUUID(),
  name: "",
  color: PRESET_COLORS[0]!,
  icon: "label",
  rules: [],
});

const CustomBundleEditor = ({
  initial,
  existingCount,
  onSave,
  onCancel,
}: {
  initial: BundleFormState;
  existingCount: number;
  onSave: (bundle: CustomBundleRecord) => void;
  onCancel: () => void;
}) => {
  const [form, setForm] = useState<BundleFormState>(initial);
  const [ruleType, setRuleType] = useState<CustomBundleRule["type"]>("domain");
  const [ruleValue, setRuleValue] = useState("");

  const addRule = () => {
    const v = ruleValue.trim().toLowerCase();
    if (!v) return;
    setForm((f) => ({ ...f, rules: [...f.rules, { type: ruleType, value: v }] }));
    setRuleValue("");
  };

  const removeRule = (i: number) =>
    setForm((f) => ({ ...f, rules: f.rules.filter((_, idx) => idx !== i) }));

  const handleSave = () => {
    if (!form.name.trim()) return;
    onSave({ ...form, name: form.name.trim(), order: 10 + existingCount });
  };

  return (
    <div className={s.editorCard}>
      <div>
        <label className={s.fieldLabel}>Bundle name</label>
        <input
          type="text"
          placeholder="My Bundle"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className={s.textInput}
        />
      </div>

      <div className={s.colorIconRow}>
        <div>
          <label className={s.fieldLabel}>Color</label>
          <div className={s.colorGrid}>
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setForm((f) => ({ ...f, color: c }))}
                className={s.colorSwatch}
                style={{
                  backgroundColor: c,
                  borderColor: form.color === c ? "#111" : "transparent",
                }}
              />
            ))}
          </div>
        </div>
        <div>
          <label className={s.fieldLabel}>Icon</label>
          <div className={s.iconGrid}>
            {PRESET_ICONS.map((name) => (
              <button
                key={name}
                onClick={() => setForm((f) => ({ ...f, icon: name }))}
                className={clsx(s.iconOption, form.icon === name && s.iconOptionActive)}
                title={name}
              >
                <Icon
                  name={name}
                  className={s.iconOptionIcon}
                  style={{ color: form.icon === name ? form.color : "#666" }}
                />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <label className={s.fieldLabel}>Rules</label>
        {form.rules.length > 0 && (
          <div className={s.ruleList}>
            {form.rules.map((rule, i) => (
              <div key={i} className={s.ruleRow}>
                <span className={s.ruleType}>{rule.type.replace("_", " ")}</span>
                <span className={s.ruleValue}>{rule.value}</span>
                <button onClick={() => removeRule(i)} className={s.ruleRemove}>
                  <Icon name="close" className={s.ruleRemoveIcon} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className={s.ruleInputRow}>
          <select
            value={ruleType}
            onChange={(e) => setRuleType(e.target.value as CustomBundleRule["type"])}
            className={s.ruleTypeSelect}
          >
            <option value="domain">Domain</option>
            <option value="email">Email address</option>
            <option value="subject_keyword">Subject keyword</option>
          </select>
          <input
            type="text"
            placeholder={
              ruleType === "domain" ? "example.com" :
              ruleType === "email" ? "user@example.com" :
              "keyword"
            }
            value={ruleValue}
            onChange={(e) => setRuleValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addRule()}
            className={s.ruleValueInput}
          />
          <button
            onClick={addRule}
            disabled={!ruleValue.trim()}
            className={s.addRuleBtn}
          >
            <Icon name="add" className={s.addRuleBtnIcon} />
          </button>
        </div>
      </div>

      <div className={s.editorActions}>
        <button onClick={onCancel} className={s.cancelBtn}>Cancel</button>
        <button
          onClick={handleSave}
          disabled={!form.name.trim()}
          className={s.saveBtn}
        >
          Save
        </button>
      </div>
    </div>
  );
};

// ─── Custom bundle list row ───────────────────────────────────────────────────

const CustomBundleRow = ({
  bundle,
  existingCount,
}: {
  bundle: CustomBundleRecord;
  existingCount: number;
}) => {
  const setCustomBundle = useMailStore((st) => st.setCustomBundle);
  const deleteCustomBundle = useMailStore((st) => st.deleteCustomBundle);
  const customBundles = useCustomBundles();
  const [editing, setEditing] = useState(false);
  const meta = getCategoryMeta(bundle.id, customBundles);

  if (editing) {
    return (
      <CustomBundleEditor
        initial={{ id: bundle.id, name: bundle.name, color: bundle.color, icon: bundle.icon, rules: bundle.rules }}
        existingCount={existingCount}
        onSave={(updated) => { setCustomBundle(updated); setEditing(false); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <div className={s.customCard}>
      <div className={s.customCardRow}>
        <Icon name={meta.icon} className={s.customCardIcon} style={{ color: meta.color }} />
        <span className={s.customCardName} style={{ color: meta.color }}>
          {meta.name}
        </span>
        <span className={s.customCardMeta}>
          {bundle.rules.length} {bundle.rules.length === 1 ? "rule" : "rules"}
        </span>
        <button
          onClick={() => setEditing(true)}
          className={s.customCardBtn}
          title="Edit"
        >
          <Icon name="edit" className={s.customCardActionIcon} />
        </button>
        <button
          onClick={() => deleteCustomBundle(bundle.id)}
          className={s.customCardDeleteBtn}
          title="Delete"
        >
          <Icon name="delete" className={s.customCardActionIcon} />
        </button>
      </div>
    </div>
  );
};

// ─── Main panel ──────────────────────────────────────────────────────────────

export const SettingsPanel = ({ onClose }: { onClose: () => void }) => {
  const customBundles = useCustomBundles();
  const setCustomBundle = useMailStore((st) => st.setCustomBundle);
  const [creatingNew, setCreatingNew] = useState(false);

  return (
    <div className={s.overlay}>
      <div className={s.backdrop} onClick={onClose} />

      <div className={s.panel}>
        <div className={s.panelHead}>
          <h2 className={s.panelTitle}>Bundle Settings</h2>
          <button onClick={onClose} className={s.closeBtn}>
            <Icon name="close" className={s.closeIcon} />
          </button>
        </div>

        <div className={s.panelBody}>
          <section>
            <h3 className={s.sectionHead}>Built-in Bundles</h3>
            <p className={s.sectionDesc}>
              Add domains to route matching emails into a built-in bundle.
            </p>
            <div className={s.sectionRows}>
              {BUNDLE_CATEGORIES.map(({ cat }) => (
                <BuiltinBundleRow key={cat} cat={cat} />
              ))}
            </div>
          </section>

          <section>
            <h3 className={s.sectionHead}>Custom Bundles</h3>
            <p className={s.sectionDesc}>
              Create your own bundles with custom rules. Rules are checked before built-in ones.
            </p>

            <div className={s.sectionRows}>
              {customBundles.map((b) => (
                <CustomBundleRow key={b.id} bundle={b} existingCount={customBundles.length} />
              ))}
            </div>

            {creatingNew ? (
              <div className={s.newBundleEditorWrap}>
                <CustomBundleEditor
                  initial={emptyForm()}
                  existingCount={customBundles.length}
                  onSave={(bundle) => { setCustomBundle(bundle); setCreatingNew(false); }}
                  onCancel={() => setCreatingNew(false)}
                />
              </div>
            ) : (
              <button
                onClick={() => setCreatingNew(true)}
                className={s.newBundleBtn}
              >
                <Icon name="add" className={s.newBundleBtnIcon} />
                New Bundle
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
