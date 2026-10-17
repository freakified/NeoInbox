import { log } from "../shared/log";
import { PORT_NAME, type ClientMsg, type ServerMsg } from "../shared/messaging";

interface BackgroundPort {
  postMessage: (msg: ClientMsg) => void;
  onMessage: { addListener: (cb: (msg: unknown) => void) => void };
  onDisconnect: { addListener: (cb: () => void) => void };
}

type RuntimeWithConnect = {
  connect: (info: { name: string }) => BackgroundPort;
};

let port: BackgroundPort | null = null;

/**
 * Commands issued while the port is down. Dropping them would silently lose
 * mutations (a saved rule, a done/trash) that the optimistic UI already
 * applied; instead they flush in order once the port reconnects.
 */
const outbox: ClientMsg[] = [];

export const send = (msg: ClientMsg): void => {
  if (!port) {
    outbox.push(msg);
    return;
  }
  try {
    port.postMessage(msg);
  } catch (e) {
    log.warn("store", "port send failed; queued for reconnect", e);
    outbox.push(msg);
  }
}

/**
 * Connects to the background and reconnects with backoff whenever the port
 * drops, flushing the outbox each time it comes back.
 */
export const connectPort = (handlers: {
  onMessage: (msg: ServerMsg) => void;
  onConnected: () => void;
  onDisconnected: () => void;
}): void => {
  const runtime = messenger.runtime as unknown as RuntimeWithConnect;
  if (!runtime.connect) {
    log.warn("store", "runtime.connect unavailable");
    return;
  }

  let backoff = 500;
  const connect = (): void => {
    const next = runtime.connect({ name: PORT_NAME });
    port = next;
    next.onMessage.addListener((raw) => {
      if (!raw || typeof raw !== "object") return;
      handlers.onMessage(raw as ServerMsg);
    });
    next.onDisconnect.addListener(() => {
      if (port === next) port = null;
      handlers.onDisconnected();
      setTimeout(() => {
        backoff = Math.min(backoff * 2, 10_000);
        connect();
      }, backoff);
    });
    handlers.onConnected();
    backoff = 500;
    send({ type: "hello" });
    // Flush anything queued while disconnected; a failed post requeues.
    for (const queued of outbox.splice(0, outbox.length)) send(queued);
  };
  connect();
};
