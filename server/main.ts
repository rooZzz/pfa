import { config } from "dotenv";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

config({ override: true });

createServer().connect(new StdioServerTransport());
