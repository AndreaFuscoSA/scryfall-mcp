import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./crea-server.js";

serveStdio(createServer);
console.error("Server MCP Scryfall avviato su stdio");