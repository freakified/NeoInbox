import { useEffect } from "react";
import { useMailStore, useToasts } from "../../store/mailStore";
import s from "./Toaster.module.css";

const AUTO_DISMISS_MS = 6000;

export const Toaster = () => {
  const toasts = useToasts();
  const dismissToast = useMailStore((st) => st.dismissToast);
  const retryToast = useMailStore((st) => st.retryToast);

  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) =>
      window.setTimeout(() => dismissToast(t.id), AUTO_DISMISS_MS),
    );
    return () => {
      for (const id of timers) window.clearTimeout(id);
    };
  }, [toasts, dismissToast]);

  if (toasts.length === 0) return null;

  return (
    <div className={s.root}>
      {toasts.map((t) => (
        <div key={t.id} className={s.toast} role="status">
          <span className={s.message}>{t.message}</span>
          {t.retry && (
            <button
              type="button"
              className={s.action}
              onClick={() => retryToast(t.id)}
            >
              Retry
            </button>
          )}
          <button
            type="button"
            className={s.dismiss}
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
};
