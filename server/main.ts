import { config } from "dotenv";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import path from "node:path";
import { createServer } from "./server.js";

config({ override: true, path: path.join(import.meta.dirname, ".env") });

createServer().connect(new StdioServerTransport());
