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

export const RemoteImagesSection = () => {
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
    <section className={s.section}>
      <h4 className={s.sectionTitle}>Remote images</h4>
      <div className={s.policyChoices}>
        <PolicyChoice
          checked={policy === "never"}
          label="Never show"
          onChange={() => updatePolicy("never")}
        />
        <PolicyChoice
          checked={policy === "always"}
          label="Always show"
          onChange={() => updatePolicy("always")}
        />
        <PolicyChoice
          checked={policy === "senders"}
          label="Only from these senders"
          onChange={() => updatePolicy("senders")}
        />
      </div>
      <div className={clsx(s.senderBlock, policy !== "senders" && s.sectionDisabled)}>
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
          <p className={s.emptyText}>No senders yet.</p>
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
      </div>
    </section>
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
