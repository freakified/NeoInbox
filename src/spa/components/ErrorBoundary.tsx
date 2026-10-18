import { Component, type ErrorInfo, type ReactNode } from "react";
import { log } from "../../shared/log";
import s from "./ErrorBoundary.module.css";

interface State {
  error: Error | null;
  componentStack: string;
}

/**
 * Without a boundary, one exception while rendering an email unmounts the
 * whole SPA and leaves a blank tab. This keeps the damage to the part that
 * threw and shows what went wrong, so it can be reported and fixed.
 *
 * `scope="app"` is the last-resort page; `scope="inline"` sits around a single
 * conversation or trip body and leaves the rest of the stream usable.
 */
export class ErrorBoundary extends Component<
  { scope: "app" | "inline"; label?: string; children: ReactNode },
  State
> {
  state: State = { error: null, componentStack: "" };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const componentStack = info.componentStack ?? "";
    this.setState({ componentStack });
    log.error("ui", `render crashed${this.props.label ? ` (${this.props.label})` : ""}`, {
      error,
      componentStack,
    });
  }

  private reset = () => this.setState({ error: null, componentStack: "" });

  render() {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;
    const details = [`${error.name}: ${error.message}`, error.stack ?? "", componentStack]
      .filter(Boolean)
      .join("\n\n");
    const app = this.props.scope === "app";
    return (
      <div
        className={app ? s.page : s.inline}
        role="alert"
        onClick={(e) => e.stopPropagation()}
      >
        <p className={s.title}>
          {app ? "NeoInbox hit an error" : `Couldn't display this ${this.props.label ?? "item"}`}
        </p>
        <p className={s.message}>{error.message}</p>
        <div className={s.actions}>
          {app ? (
            <button type="button" className={s.button} onClick={() => location.reload()}>
              Reload
            </button>
          ) : (
            <button type="button" className={s.button} onClick={this.reset}>
              Try again
            </button>
          )}
          <button
            type="button"
            className={s.button}
            onClick={() => void navigator.clipboard?.writeText(details)}
          >
            Copy details
          </button>
        </div>
        <details className={s.details}>
          <summary>Details</summary>
          <pre className={s.stack}>{details}</pre>
        </details>
      </div>
    );
  }
}
