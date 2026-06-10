import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const dir = import.meta.dirname;
const css =
  readFileSync(path.join(dir, "assets", "auth.css"), "utf8") +
  readFileSync(path.join(dir, "..", "ui", "styles", "tokens.css"), "utf8");

export const authCssVersion = createHash("sha256").update(css).digest("hex").slice(0, 8);
