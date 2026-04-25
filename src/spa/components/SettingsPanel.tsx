import { useState } from "react";
import { CATEGORIES, getCategoryMeta } from "../../shared/categories";
import type { BuiltinCategory, CustomBundleRecord, CustomBundleRule } from "../../shared/types";
import { useMailStore, useCustomBundles, useOverrides } from "../../store/mailStore";
import { Icon } from "./Icon";

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
  const setOverride = useMailStore((s) => s.setOverride);
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
    <div className="border border-md-divider rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <Icon name={meta.icon} className="text-xl" style={{ color: meta.color }} />
        <span className="font-medium text-sm flex-1" style={{ color: meta.color }}>
          {meta.name}
        </span>
        {added.length > 0 && (
          <span className="text-xs text-md-secondary-text">{added.length} added</span>
        )}
        <Icon name={expanded ? "expand_less" : "expand_more"} className="text-lg text-md-secondary-text" />
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-md-divider bg-neutral-50">
          <p className="text-xs text-md-secondary-text mt-3 mb-2">
            Emails from these domains are always routed to {meta.name}.
          </p>

          {added.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {added.map((domain) => (
                <span
                  key={domain}
                  className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-white border border-md-divider"
                >
                  {domain}
                  <button
                    onClick={() => handleRemove(domain)}
                    className="text-md-secondary-text hover:text-md-on-surface"
                  >
                    <Icon name="close" className="text-sm" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              placeholder="example.com"
              value={adding}
              onChange={(e) => setAdding(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
              className="flex-1 text-sm px-3 py-1.5 border border-md-divider rounded bg-white focus:outline-none focus:ring-1 focus:ring-md-primary"
            />
            <button
              onClick={handleAdd}
              disabled={!adding.trim()}
              className="text-sm px-3 py-1.5 rounded bg-md-primary text-white hover:opacity-90 disabled:opacity-40"
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
    <div className="border border-md-divider rounded-lg p-4 bg-neutral-50 space-y-4">
      {/* Name */}
      <div>
        <label className="text-xs font-medium text-md-secondary-text block mb-1">Bundle name</label>
        <input
          type="text"
          placeholder="My Bundle"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="w-full text-sm px-3 py-1.5 border border-md-divider rounded bg-white focus:outline-none focus:ring-1 focus:ring-md-primary"
        />
      </div>

      {/* Color + Icon */}
      <div className="flex gap-6">
        <div>
          <label className="text-xs font-medium text-md-secondary-text block mb-1">Color</label>
          <div className="flex flex-wrap gap-1.5">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setForm((f) => ({ ...f, color: c }))}
                className="w-6 h-6 rounded-full border-2 transition-all"
                style={{
                  backgroundColor: c,
                  borderColor: form.color === c ? "#111" : "transparent",
                }}
              />
            ))}
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-md-secondary-text block mb-1">Icon</label>
          <div className="flex flex-wrap gap-1 max-w-[200px]">
            {PRESET_ICONS.map((name) => (
              <button
                key={name}
                onClick={() => setForm((f) => ({ ...f, icon: name }))}
                className={`p-1 rounded hover:bg-white ${form.icon === name ? "bg-white ring-1 ring-md-primary" : ""}`}
                title={name}
              >
                <Icon
                  name={name}
                  className="text-lg"
                  style={{ color: form.icon === name ? form.color : "#666" }}
                />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Rules */}
      <div>
        <label className="text-xs font-medium text-md-secondary-text block mb-1">Rules</label>
        {form.rules.length > 0 && (
          <div className="space-y-1 mb-2">
            {form.rules.map((rule, i) => (
              <div key={i} className="flex items-center gap-2 text-sm bg-white px-3 py-1.5 rounded border border-md-divider">
                <span className="text-xs text-md-secondary-text capitalize shrink-0">
                  {rule.type.replace("_", " ")}
                </span>
                <span className="flex-1 truncate">{rule.value}</span>
                <button
                  onClick={() => removeRule(i)}
                  className="text-md-secondary-text hover:text-md-on-surface shrink-0"
                >
                  <Icon name="close" className="text-sm" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <select
            value={ruleType}
            onChange={(e) => setRuleType(e.target.value as CustomBundleRule["type"])}
            className="text-sm px-2 py-1.5 border border-md-divider rounded bg-white focus:outline-none"
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
            className="flex-1 text-sm px-3 py-1.5 border border-md-divider rounded bg-white focus:outline-none focus:ring-1 focus:ring-md-primary"
          />
          <button
            onClick={addRule}
            disabled={!ruleValue.trim()}
            className="text-sm px-3 py-1.5 rounded border border-md-divider bg-white hover:bg-neutral-100 disabled:opacity-40"
          >
            <Icon name="add" className="text-base" />
          </button>
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          className="text-sm px-4 py-1.5 rounded border border-md-divider hover:bg-neutral-100"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!form.name.trim()}
          className="text-sm px-4 py-1.5 rounded bg-md-primary text-white hover:opacity-90 disabled:opacity-40"
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
  const setCustomBundle = useMailStore((s) => s.setCustomBundle);
  const deleteCustomBundle = useMailStore((s) => s.deleteCustomBundle);
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
    <div className="border border-md-divider rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <Icon name={meta.icon} className="text-xl" style={{ color: meta.color }} />
        <span className="font-medium text-sm flex-1" style={{ color: meta.color }}>
          {meta.name}
        </span>
        <span className="text-xs text-md-secondary-text">
          {bundle.rules.length} {bundle.rules.length === 1 ? "rule" : "rules"}
        </span>
        <button
          onClick={() => setEditing(true)}
          className="text-md-secondary-text hover:text-md-on-surface p-1"
          title="Edit"
        >
          <Icon name="edit" className="text-base" />
        </button>
        <button
          onClick={() => deleteCustomBundle(bundle.id)}
          className="text-md-secondary-text hover:text-red-500 p-1"
          title="Delete"
        >
          <Icon name="delete" className="text-base" />
        </button>
      </div>
    </div>
  );
};

// ─── Main panel ──────────────────────────────────────────────────────────────

export const SettingsPanel = ({ onClose }: { onClose: () => void }) => {
  const customBundles = useCustomBundles();
  const setCustomBundle = useMailStore((s) => s.setCustomBundle);
  const [creatingNew, setCreatingNew] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto w-full max-w-lg h-full bg-white shadow-xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-md-divider bg-md-primary">
          <h2 className="text-lg font-medium text-white">Bundle Settings</h2>
          <button onClick={onClose} className="text-white/80 hover:text-white">
            <Icon name="close" className="text-2xl" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-6 py-6 space-y-8">
          {/* Built-in bundles */}
          <section>
            <h3 className="text-sm font-semibold text-md-secondary-text uppercase tracking-wide mb-3">
              Built-in Bundles
            </h3>
            <p className="text-xs text-md-secondary-text mb-4">
              Add domains to route matching emails into a built-in bundle.
            </p>
            <div className="space-y-2">
              {BUNDLE_CATEGORIES.map(({ cat }) => (
                <BuiltinBundleRow key={cat} cat={cat} />
              ))}
            </div>
          </section>

          {/* Custom bundles */}
          <section>
            <h3 className="text-sm font-semibold text-md-secondary-text uppercase tracking-wide mb-3">
              Custom Bundles
            </h3>
            <p className="text-xs text-md-secondary-text mb-4">
              Create your own bundles with custom rules. Rules are checked before built-in ones.
            </p>

            <div className="space-y-2">
              {customBundles.map((b) => (
                <CustomBundleRow key={b.id} bundle={b} existingCount={customBundles.length} />
              ))}
            </div>

            {creatingNew ? (
              <div className="mt-2">
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
                className="mt-3 w-full flex items-center justify-center gap-2 text-sm px-4 py-2.5 rounded-lg border-2 border-dashed border-md-divider text-md-secondary-text hover:border-md-primary hover:text-md-primary transition-colors"
              >
                <Icon name="add" className="text-base" />
                New Bundle
              </button>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
