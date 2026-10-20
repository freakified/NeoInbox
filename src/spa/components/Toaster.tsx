import { useEffect } from "react";
import { useMailStore, useToasts } from "../../store/mailStore";
import s from "./Toaster.module.css";

const AUTO_DISMISS_MS = 6000;

export const Toaster = () => {
  const toasts = useToasts();
  const dismissToast = useMailStore((st) => st.dismissToast);
  const retryToast = useMailStore((st) => st.retryToast);
  const undoToast = useMailStore((st) => st.undoToast);

  useEffect(() => {
    if (toasts.length === 0) return;
    // Undo toasts are dismissed by the store's commit timer, and progress
    // toasts by the work finishing; skip them here.
    const timers = toasts
      .filter((t) => !t.undo && !t.progress)
      .map((t) => window.setTimeout(() => dismissToast(t.id), AUTO_DISMISS_MS));
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
          {t.undo && (
            <button
              type="button"
              className={s.action}
              onClick={() => undoToast(t.id)}
            >
              Undo
            </button>
          )}
          {t.retry && (
            <button
              type="button"
              className={s.action}
              onClick={() => retryToast(t.id)}
            >
              Retry
            </button>
          )}
          {t.actions?.map((action) => (
            <button
              key={action.label}
              type="button"
              className={s.action}
              onClick={() => {
                action.run();
                dismissToast(t.id);
              }}
            >
              {action.label}
            </button>
          ))}
          {!t.progress && (
            <button
              type="button"
              className={s.dismiss}
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
};
