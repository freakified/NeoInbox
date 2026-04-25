import {
  PORT_NAME,
  type ClientMsg,
  type ServerMsg,
} from "../shared/messaging";

type Port = {
  name: string;
  onMessage: { addListener: (cb: (msg: unknown) => void) => void };
  onDisconnect: { addListener: (cb: () => void) => void };
  postMessage: (msg: ServerMsg) => void;
};

type PortApi = {
  onConnect: { addListener: (cb: (port: Port) => void) => void };
};

const ports = new Set<Port>();
let handler: ((msg: ClientMsg) => void | Promise<void>) | null = null;

export const onCommand = (
  cb: (msg: ClientMsg) => void | Promise<void>,
): void => {
  handler = cb;
}

export const broadcast = (msg: ServerMsg): void => {
  for (const port of ports) {
    try {
      port.postMessage(msg);
    } catch (e) {
      console.warn("[NeoInbox] port broadcast failed", e);
    }
  }
}

export const startPortServer = (): void => {
  const api = (messenger.runtime as unknown as PortApi).onConnect;
  if (!api) {
    console.warn("[NeoInbox] runtime.onConnect unavailable");
    return;
  }
  api.addListener((port) => {
    if (port.name !== PORT_NAME) return;
    ports.add(port);
    port.onMessage.addListener((raw) => {
      if (!raw || typeof raw !== "object") return;
      const msg = raw as ClientMsg;
      Promise.resolve(handler?.(msg)).catch((e) => {
        console.warn("[NeoInbox] command handler error", msg, e);
        try {
          port.postMessage({ type: "error", message: String(e) });
        } catch {
          // port may be closed
        }
      });
    });
    port.onDisconnect.addListener(() => {
      ports.delete(port);
    });
  });
}
