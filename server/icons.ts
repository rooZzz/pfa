type Icon = {
  src: string;
  mimeType: string;
  sizes: string[];
  theme: "light" | "dark";
};

const CLAY_MARK_BASE64 =
  "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCIgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0Ij48cGF0aCBmaWxsPSIjYjg2NzNlIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik0xMiAxMiBMNTIgMTIgQTQwIDQwIDAgMCAxIDEyIDUyIFogTTIwLjMgMjUuNSBhNS4yIDUuMiAwIDEgMCAxMC40IDAgYTUuMiA1LjIgMCAxIDAgLTEwLjQgMCBaIi8+PC9zdmc+";

const CLAY_DARK_MARK_BASE64 =
  "PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCIgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0Ij48cGF0aCBmaWxsPSIjZGU4YzVkIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik0xMiAxMiBMNTIgMTIgQTQwIDQwIDAgMCAxIDEyIDUyIFogTTIwLjMgMjUuNSBhNS4yIDUuMiAwIDEgMCAxMC40IDAgYTUuMiA1LjIgMCAxIDAgLTEwLjQgMCBaIi8+PC9zdmc+";

export const PFA_ICONS: Icon[] = [
  {
    src: `data:image/svg+xml;base64,${CLAY_MARK_BASE64}`,
    mimeType: "image/svg+xml",
    sizes: ["any"],
    theme: "light",
  },
  {
    src: `data:image/svg+xml;base64,${CLAY_DARK_MARK_BASE64}`,
    mimeType: "image/svg+xml",
    sizes: ["any"],
    theme: "dark",
  },
];
