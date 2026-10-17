import { clsx } from "clsx";
import { useEffect, useState } from "react";
import { useMailStore } from "../../../store/mailStore";
import {
  getRemoteImagePolicy,
  listTrustedImageSenders,
  type RemoteImagePolicy,
  setRemoteImagePolicy,
  subscribeTrustedImageSenders,
  trustImageSender,
  untrustImageSender,
} from "../../lib/remoteImagePrefs";
import { Icon } from "../Icon";
import s from "../BundleManagerModal.module.css";

const normalizeEmail = (value: string): string => value.trim().toLowerCase();

export const RemoteImagesSettings = () => {
  const notify = useMailStore((st) => st.notify);
  const [senders, setSenders] = useState(() => listTrustedImageSenders());
  const [policy, setPolicy] = useState<RemoteImagePolicy>(() => getRemoteImagePolicy());
  const [email, setEmail] = useState("");

  useEffect(
    () =>
      subscribeTrustedImageSenders(() => {
        setSenders(listTrustedImageSenders());
        setPolicy(getRemoteImagePolicy());
      }),
    [],
  );

  const normalizedEmail = normalizeEmail(email);
  const canAdd = policy === "senders" && normalizedEmail.includes("@");

  const addSender = () => {
    if (!canAdd) return;
    trustImageSender(normalizedEmail);
    setEmail("");
    notify(`Images allowed from ${normalizedEmail}`);
  };

  const removeSender = (sender: string) => {
    untrustImageSender(sender);
    notify(`Images blocked from ${sender}`);
  };

  const updatePolicy = (next: RemoteImagePolicy) => {
    setRemoteImagePolicy(next);
    setPolicy(next);
  };

  return (
    <div className={s.editor}>
      <div className={s.editorHeader}>
        <Icon name="image" className={s.editorIcon} />
        <div>
          <h3 className={s.editorTitle}>Remote Images</h3>
          <p className={s.editorDesc}>Control which senders can display remote images automatically.</p>
        </div>
      </div>

      <section className={s.section}>
        <h4 className={s.sectionTitle}>Display</h4>
        <div className={s.policyChoices}>
          <PolicyChoice
            checked={policy === "never"}
            label="Never show remote images"
            onChange={() => updatePolicy("never")}
          />
          <PolicyChoice
            checked={policy === "always"}
            label="Always show remote images"
            onChange={() => updatePolicy("always")}
          />
          <PolicyChoice
            checked={policy === "senders"}
            label="Only show from the following senders"
            onChange={() => updatePolicy("senders")}
          />
        </div>
      </section>

      <section className={clsx(s.section, policy !== "senders" && s.sectionDisabled)}>
        <div className={s.senderInputRow}>
          <input
            type="email"
            className={s.input}
            value={email}
            placeholder="sender@example.com"
            disabled={policy !== "senders"}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addSender()}
          />
          <button type="button" className={s.primaryBtn} disabled={!canAdd} onClick={addSender}>
            Add sender
          </button>
        </div>
        {senders.length === 0 ? (
          <p className={s.emptyText}>No senders are allowed yet.</p>
        ) : (
          <div className={s.ruleList}>
            {senders.map((sender) => (
              <div className={s.senderRow} key={sender}>
                <span className={s.senderValue}>{sender}</span>
                <button
                  type="button"
                  className={s.ruleRemove}
                  onClick={() => removeSender(sender)}
                  title="Remove sender"
                >
                  <Icon name="delete" className={clsx(s.ruleRemoveIcon, s.ruleDeleteIcon)} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

const PolicyChoice = ({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: () => void;
}) => (
  <label className={s.policyChoice}>
    <input
      type="radio"
      name="remote-image-policy"
      checked={checked}
      onChange={onChange}
      className={s.policyInput}
    />
    <span>{label}</span>
  </label>
);
