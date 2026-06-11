import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { fixtureResult } from "./fixtures.js";

const SCREENS = ["net_worth", "cashflow", "upload", "connectors"] as const;
const WIDTHS = [320, 375, 420, 460, 500, 780] as const;
const THEMES = ["dark", "light"] as const;

type Screen = (typeof SCREENS)[number];
type Theme = (typeof THEMES)[number];

type HarnessState = { screen: Screen; theme: Theme };

const bridges: AppBridge[] = [];
const frames: HTMLIFrameElement[] = [];

function readState(): HarnessState {
  const [screen, theme] = window.location.hash.replace(/^#/, "").split("/");
  return {
    screen: SCREENS.includes(screen as Screen) ? (screen as Screen) : "net_worth",
    theme: THEMES.includes(theme as Theme) ? (theme as Theme) : "dark",
  };
}

function writeState(state: HarnessState): void {
  window.location.hash = `${state.screen}/${state.theme}`;
}

function applyTheme(frame: HTMLIFrameElement, theme: Theme): void {
  const doc = frame.contentDocument;
  if (doc) doc.documentElement.dataset.theme = theme;
}

function dropSampleFile(frame: HTMLIFrameElement): void {
  const input =
    frame.contentDocument?.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) return;
  const file = new File(["pfa-preview"], "2026-05_payslip_acme_industries.pdf", {
    type: "application/pdf",
  });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function attachBridge(frame: HTMLIFrameElement): Promise<void> {
  const bridge = new AppBridge(
    null,
    { name: "pfa-preview", version: "0.0.0" },
    { serverTools: {} },
  );
  bridge.oncalltool = async (params) => fixtureResult(params.name);
  bridge.addEventListener("sizechange", ({ height }) => {
    if (height) frame.style.height = `${Math.ceil(height)}px`;
  });
  bridges.push(bridge);
  await bridge.connect(
    new PostMessageTransport(frame.contentWindow ?? undefined, frame.contentWindow!),
  );
}

function renderFrames(state: HarnessState): void {
  for (const bridge of bridges.splice(0)) void bridge.close();
  frames.length = 0;
  const container = document.getElementById("frames")!;
  container.replaceChildren();
  for (const width of WIDTHS) {
    const cell = document.createElement("div");
    cell.className = "frame-cell";
    cell.style.width = `${width}px`;
    const label = document.createElement("div");
    label.className = "frame-label";
    label.textContent = `${width}px`;
    const frame = document.createElement("iframe");
    frame.src = `/screen/${state.screen}`;
    frame.addEventListener("load", () => applyTheme(frame, state.theme));
    cell.append(label, frame);
    container.append(cell);
    frames.push(frame);
    void attachBridge(frame);
  }
}

function renderControls(state: HarnessState): void {
  const controls = document.getElementById("controls")!;
  controls.replaceChildren();
  for (const screen of SCREENS) {
    const button = document.createElement("button");
    button.textContent = screen;
    button.className = screen === state.screen ? "active" : "";
    button.addEventListener("click", () => writeState({ ...state, screen }));
    controls.append(button);
  }
  const spacer = document.createElement("span");
  spacer.style.flex = "1";
  controls.append(spacer);
  if (state.screen === "upload") {
    const drop = document.createElement("button");
    drop.textContent = "load sample payslip";
    drop.addEventListener("click", () => {
      for (const frame of frames) dropSampleFile(frame);
    });
    controls.append(drop);
  }
  for (const theme of THEMES) {
    const button = document.createElement("button");
    button.textContent = theme;
    button.className = theme === state.theme ? "active" : "";
    button.addEventListener("click", () => writeState({ ...state, theme }));
    controls.append(button);
  }
}

function render(): void {
  const state = readState();
  renderControls(state);
  renderFrames(state);
}

window.addEventListener("hashchange", render);
render();
