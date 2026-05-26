import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

process.loadEnvFile(new URL(".env", import.meta.url));

createServer().connect(new StdioServerTransport());
