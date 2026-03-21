import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({
    command: path.resolve(process.cwd(), "node_modules/.bin/tsx"),
    args: ["src/mcp/server.ts"],
    cwd: process.cwd(),
    stderr: "inherit",
  });

  const client = new Client({
    name: "toonflow-mcp-smoke",
    version: "0.1.0",
  });

  await client.connect(transport);

  const toolList = await client.listTools();
  const toolNames = toolList.tools.map((tool) => tool.name);
  const expectedTools = [
    "toonflow_login",
    "toonflow_get_model_bindings",
    "toonflow_create_project",
    "toonflow_import_novel",
    "toonflow_run_outline_agent",
    "toonflow_generate_script",
    "toonflow_list_assets",
    "toonflow_generate_asset_image",
    "toonflow_run_storyboard_agent",
    "toonflow_get_storyboards",
    "toonflow_create_video_config",
    "toonflow_generate_video",
    "toonflow_get_video",
  ];

  const missingTools = expectedTools.filter((tool) => !toolNames.includes(tool));
  if (missingTools.length > 0) {
    throw new Error(`Missing expected tools: ${missingTools.join(", ")}`);
  }

  const username = process.env.TOONFLOW_MCP_USERNAME;
  const password = process.env.TOONFLOW_MCP_PASSWORD;
  if (username && password) {
    const login = await client.callTool({
      name: "toonflow_login",
      arguments: {
        username,
        password,
      },
    });
    if (!login.structuredContent || (login.structuredContent as { ok?: boolean }).ok !== true) {
      throw new Error(`Login smoke test failed: ${JSON.stringify(login, null, 2)}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        toolCount: toolNames.length,
        checkedTools: expectedTools.length,
        cwd: path.resolve(process.cwd()),
      },
      null,
      2,
    ),
  );

  await client.close();
}

main().catch((error) => {
  console.error("[mcp-smoke] failed", error);
  process.exit(1);
});
