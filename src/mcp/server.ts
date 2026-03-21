import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ToonflowHttpClient } from "./client/http";
import { runtimeConfig } from "./config";
import { registerAssetTools } from "./tools/assets";
import { registerAuthTools } from "./tools/auth";
import { registerOutlineTools } from "./tools/outline";
import { registerProjectTools } from "./tools/project";
import { registerStoryboardTools } from "./tools/storyboard";
import { registerVideoTools } from "./tools/video";

export function createToonflowMcpServer() {
  const server = new McpServer({
    name: "toonflow-mcp",
    version: "0.1.0",
  });

  const http = new ToonflowHttpClient(runtimeConfig);

  registerAuthTools(server, http, runtimeConfig);
  registerProjectTools(server, http, runtimeConfig);
  registerOutlineTools(server, http, runtimeConfig);
  registerAssetTools(server, http, runtimeConfig);
  registerStoryboardTools(server, http, runtimeConfig);
  registerVideoTools(server, http, runtimeConfig);

  return server;
}

async function main() {
  const server = createToonflowMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("[toonflow-mcp] failed to start", error);
    process.exit(1);
  });
}
