function resolveTheme(): "light" | "dark" {
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return "dark";
}

function applyTheme(): void {
  document.documentElement.dataset.theme = resolveTheme();
}

applyTheme();

if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
  window
    .matchMedia("(prefers-color-scheme: light)")
    .addEventListener("change", applyTheme);
}
