import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import "./landing.css";

// The demo window's traffic lights. Zoom is a plain link to /demo; close and
// minimize send the window into a dock, and its icon brings it back. Close
// also restarts the demo, since every load of it starts from a fresh mailbox.

type Mode = "closed" | "minimized";

const STATUS: Record<Mode, string> = {
  closed: "Demo closed. Click the icon to begin again.",
  minimized: "Demo minimized. I apologize about the lack of the \"genie\" animation.",
};
// Must match the transitions in landing.css.
const HIDE_MS: Record<Mode, number> = { closed: 200, minimized: 500 };
const RESTORE_MS = 450;
const STAGE_MS = 400;
const DOCK_MS = 300;
const DOCKED_HEIGHT = 170;

const stage = document.querySelector<HTMLElement>(".stage")!;
const win = stage.querySelector<HTMLElement>(".window")!;
const frame = win.querySelector("iframe")!;
const dock = stage.querySelector<HTMLElement>(".dock")!;
const dockApp = dock.querySelector<HTMLButtonElement>(".dock-app")!;
const status = dock.querySelector<HTMLElement>(".dock-status")!;

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, reducedMotion.matches ? 0 : ms));

let mode: Mode | null = null;
let busy = false;
let windowHeight = 0;

const hide = async (next: Mode): Promise<void> => {
  if (busy || mode) return;
  busy = true;
  mode = next;
  windowHeight = stage.offsetHeight;
  stage.style.height = `${windowHeight}px`;
  win.classList.add(next);
  await wait(HIDE_MS[next]);
  win.classList.add("gone");
  if (next === "closed") frame.src = frame.src;

  stage.style.height = `${DOCKED_HEIGHT}px`;
  dock.dataset.mode = next;
  status.textContent = STATUS[next];
  dock.hidden = false;
  await wait(STAGE_MS);
  dock.classList.add("shown");
  dockApp.focus();
  await wait(DOCK_MS);
  busy = false;
};

const restore = async (): Promise<void> => {
  if (busy || !mode) return;
  busy = true;
  dock.classList.remove("shown");
  await wait(DOCK_MS);
  dock.hidden = true;
  stage.style.height = `${windowHeight}px`;
  await wait(STAGE_MS);
  win.classList.remove("gone", mode);
  await wait(RESTORE_MS);
  stage.style.height = "";
  mode = null;
  busy = false;
};

// Load the demo only where there's room for it (landing.css's breakpoint);
// phones see a screenshot, with the traffic lights out of reach.
const wide = matchMedia("(min-width: 761px)");
const lights = win.querySelector<HTMLElement>(".lights")!;
const shot = win.querySelector<HTMLImageElement>(".window-shot")!;
const fit = (): void => {
  lights.inert = !wide.matches;
  if (wide.matches && !frame.src) frame.src = frame.dataset.src!;
  if (!wide.matches && !shot.src) shot.src = shot.dataset.src!;
};
fit();
wide.addEventListener("change", fit);

win.querySelector(".lights .close")!.addEventListener("click", () => void hide("closed"));
win.querySelector(".lights .minimize")!.addEventListener("click", () => void hide("minimized"));
dockApp.addEventListener("click", () => void restore());

// The footer's hit counter: total visits from GoatCounter, shown once it
// answers. The demo iframe isn't counted (count.js skips frames).
fetch("https://neoinbox-counter.freakified.net/counter/TOTAL.json")
  .then((r) => r.json())
  .then((data: { count?: string }) => {
    if (!data?.count) return;
    const counter = document.querySelector<HTMLElement>(".visitor-counter")!;
    counter.querySelector(".visitor-digits")!.textContent = data.count.padStart(6, "0");
    counter.hidden = false;
  })
  .catch(() => {});
