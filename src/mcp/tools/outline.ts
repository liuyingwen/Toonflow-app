import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "crypto";
import { z } from "zod";
import { ToonflowRuntimeConfig } from "../config";
import { ToonflowHttpClient } from "../client/http";
import { ToonflowWsSession } from "../client/ws";
import { withToolResult } from "../types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface OutlineSessionEntry {
  session: ToonflowWsSession;
  projectId: number;
  createdAt: string;
}

const outlineSessions = new Map<string, OutlineSessionEntry>();

function normalizeOutline(row: Record<string, unknown>) {
  const data = typeof row.data === "string" ? JSON.parse(row.data) : {};
  return {
    outlineId: Number(row.id),
    projectId: Number(row.projectId),
    episode: Number(row.episode),
    ...data,
  };
}

function normalizeScript(row: Record<string, unknown>) {
  return {
    scriptId: Number(row.id),
    outlineId: Number(row.outlineId),
    projectId: Number(row.projectId),
    name: String(row.name || ""),
    content: String(row.content || ""),
    data: row.data,
    element: Array.isArray(row.element) ? row.element : undefined,
  };
}

async function fetchOutlineState(http: ToonflowHttpClient, projectId: number) {
  const [storylineResponse, outlineResponse, scriptsResponse] = await Promise.all([
    http.post<Record<string, unknown> | null>("/outline/getStoryline", { projectId }),
    http.post<Array<Record<string, unknown>>>("/outline/getOutline", { projectId }),
    http.post<Array<Record<string, unknown>>>("/script/geScriptApi", { projectId }),
  ]);

  return {
    storyline: storylineResponse.data
      ? {
          id: Number(storylineResponse.data.id),
          projectId: Number(storylineResponse.data.projectId),
          content: String(storylineResponse.data.content || ""),
        }
      : null,
    outlines: outlineResponse.data.map(normalizeOutline),
    scripts: scriptsResponse.data.map(normalizeScript),
  };
}

async function sendAgentMessages(session: ToonflowWsSession, messages: string[], timeoutMs: number) {
  const responseTexts: string[] = [];
  let cursor = session.getLastIndex();

  for (const message of messages) {
    session.send({
      type: "msg",
      data: {
        type: "user",
        data: message,
      },
    });

    const event = await session.waitFor(
      (candidate) => candidate.type === "response_end" || candidate.type === "error",
      timeoutMs,
      "Outline agent response timeout",
      cursor,
    );

    cursor = event.index;
    if (event.type === "error") {
      throw new Error(String(event.data || "Outline agent failed"));
    }
    responseTexts.push(String(event.data || ""));
    await sleep(200);
    cursor = session.getLastIndex();
  }

  return responseTexts;
}

async function clearSessionHistory(session: ToonflowWsSession) {
  const cursor = session.getLastIndex();
  session.send({ type: "cleanHistory", data: null });
  await session.waitFor(
    (event) => event.type === "notice" || event.type === "error",
    10_000,
    "Outline cleanHistory timeout",
    cursor,
  );
}

async function sendSingleAgentMessage(session: ToonflowWsSession, message: string, timeoutMs: number) {
  const cursor = session.getLastIndex();
  session.send({
    type: "msg",
    data: {
      type: "user",
      data: message,
    },
  });

  const event = await session.waitFor(
    (candidate) => candidate.type === "response_end" || candidate.type === "error",
    timeoutMs,
    "Outline agent response timeout",
    cursor,
  );

  if (event.type === "error") {
    throw new Error(String(event.data || "Outline agent failed"));
  }

  await sleep(200);

  return {
    response: String(event.data || ""),
    events: session.getEvents().filter((candidate) => candidate.index > cursor),
  };
}

export function registerOutlineTools(server: McpServer, http: ToonflowHttpClient, runtime: ToonflowRuntimeConfig) {
  server.registerTool(
    "toonflow_open_outline_agent_session",
    {
      title: "Open Toonflow Outline Agent Session",
      description: "Open a persistent Toonflow outline WebSocket session for step-by-step guided interaction.",
      inputSchema: {
        project_id: z.number().optional(),
        clear_history: z.boolean().optional(),
        timeout_ms: z.number().optional(),
      },
    },
    withToolResult(async ({ project_id, clear_history, timeout_ms }) => {
      const projectId = runtime.resolveId("projectId", project_id);
      const timeoutMs = timeout_ms ?? 1_800_000;
      const session = new ToonflowWsSession(runtime);
      await session.connect("/outline/agentsOutline", { projectId }, { timeoutMs, waitForInit: true });

      try {
        if (clear_history) {
          await clearSessionHistory(session);
        }
      } catch (error) {
        await session.close();
        throw error;
      }

      const sessionId = randomUUID();
      outlineSessions.set(sessionId, {
        session,
        projectId,
        createdAt: new Date().toISOString(),
      });

      runtime.remember({ projectId });

      return {
        message: "Outline agent session opened",
        data: {
          sessionId,
          projectId,
          createdAt: outlineSessions.get(sessionId)?.createdAt,
          events: session.getEvents(),
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_send_outline_agent_session_message",
    {
      title: "Send Toonflow Outline Agent Session Message",
      description: "Send one user message into an existing Toonflow outline WebSocket session and wait for the next response_end.",
      inputSchema: {
        session_id: z.string(),
        message: z.string().min(1),
        refresh_state: z.boolean().optional(),
        timeout_ms: z.number().optional(),
      },
    },
    withToolResult(async ({ session_id, message, refresh_state, timeout_ms }) => {
      const entry = outlineSessions.get(session_id);
      if (!entry) {
        throw new Error(`Outline session not found: ${session_id}`);
      }

      const timeoutMs = timeout_ms ?? 1_800_000;

      try {
        const result = await sendSingleAgentMessage(entry.session, message, timeoutMs);
        const state = refresh_state === false ? null : await fetchOutlineState(http, entry.projectId);

        if (state?.outlines[0]) {
          runtime.remember({
            projectId: entry.projectId,
            outlineId: state.outlines[0].outlineId,
            scriptId: state.scripts[0]?.scriptId,
          });
        } else {
          runtime.remember({ projectId: entry.projectId });
        }

        return {
          message: "Outline agent step completed",
          data: {
            sessionId: session_id,
            projectId: entry.projectId,
            response: result.response,
            refreshEvents: result.events
              .filter((event) => event.type === "refresh")
              .map((event) => String(event.data || "")),
            events: result.events,
            ...(state || {}),
          },
        };
      } catch (error) {
        outlineSessions.delete(session_id);
        await entry.session.close().catch(() => undefined);
        throw error;
      }
    }),
  );

  server.registerTool(
    "toonflow_close_outline_agent_session",
    {
      title: "Close Toonflow Outline Agent Session",
      description: "Close a persistent Toonflow outline WebSocket session.",
      inputSchema: {
        session_id: z.string(),
        refresh_state: z.boolean().optional(),
      },
    },
    withToolResult(async ({ session_id, refresh_state }) => {
      const entry = outlineSessions.get(session_id);
      if (!entry) {
        throw new Error(`Outline session not found: ${session_id}`);
      }

      outlineSessions.delete(session_id);
      await entry.session.close();

      const state = refresh_state === false ? null : await fetchOutlineState(http, entry.projectId);
      if (state?.outlines[0]) {
        runtime.remember({
          projectId: entry.projectId,
          outlineId: state.outlines[0].outlineId,
          scriptId: state.scripts[0]?.scriptId,
        });
      } else {
        runtime.remember({ projectId: entry.projectId });
      }

      return {
        message: "Outline agent session closed",
        data: {
          sessionId: session_id,
          projectId: entry.projectId,
          ...(state || {}),
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_run_outline_agent",
    {
      title: "Run Toonflow Outline Agent",
      description: "Run Toonflow's outline WebSocket agent to generate storyline, outlines, scripts, and asset metadata.",
      inputSchema: {
        project_id: z.number().optional(),
        messages: z.array(z.string()).min(1),
        clear_history: z.boolean().optional(),
        refresh_state: z.boolean().optional(),
        timeout_ms: z.number().optional(),
      },
    },
    withToolResult(async ({ project_id, messages, clear_history, refresh_state, timeout_ms }) => {
      const projectId = runtime.resolveId("projectId", project_id);
      const session = new ToonflowWsSession(runtime);
      const timeoutMs = timeout_ms ?? 1_800_000;

      try {
        await session.connect("/outline/agentsOutline", { projectId }, { timeoutMs, waitForInit: true });

        if (clear_history) {
          await clearSessionHistory(session);
        }

        const responseTexts = await sendAgentMessages(session, messages, timeoutMs);
        const state = refresh_state === false ? null : await fetchOutlineState(http, projectId);

        if (state?.outlines[0]) {
          runtime.remember({
            projectId,
            outlineId: state.outlines[0].outlineId,
            scriptId: state.scripts[0]?.scriptId,
          });
        }

        return {
          message: "Outline agent completed",
          data: {
            projectId,
            finalResponse: responseTexts[responseTexts.length - 1] || "",
            responses: responseTexts,
            refreshEvents: session
              .getEvents()
              .filter((event) => event.type === "refresh")
              .map((event) => String(event.data || "")),
            events: session.getEvents(),
            ...(state || {}),
          },
        };
      } finally {
        await session.close();
      }
    }),
  );

  server.registerTool(
    "toonflow_update_storyline",
    {
      title: "Update Toonflow Storyline",
      description: "Create or overwrite the saved storyline for a project.",
      inputSchema: {
        project_id: z.number().optional(),
        content: z.string(),
      },
    },
    withToolResult(async ({ project_id, content }) => {
      const projectId = runtime.resolveId("projectId", project_id);
      const response = await http.post("/outline/updateStoryline", {
        projectId,
        content,
      });

      runtime.remember({ projectId });

      return {
        message: response.message,
        data: {
          projectId,
          storyline: {
            projectId,
            content,
          },
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_get_storyline",
    {
      title: "Get Toonflow Storyline",
      description: "Get the saved storyline for a project.",
      inputSchema: {
        project_id: z.number().optional(),
      },
    },
    withToolResult(async ({ project_id }) => {
      const projectId = runtime.resolveId("projectId", project_id);
      const response = await http.post<Record<string, unknown> | null>("/outline/getStoryline", { projectId });
      runtime.remember({ projectId });
      return {
        message: response.message,
        data: {
          projectId,
          storyline: response.data
            ? {
                id: Number(response.data.id),
                projectId: Number(response.data.projectId),
                content: String(response.data.content || ""),
              }
            : null,
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_get_outlines",
    {
      title: "Get Toonflow Outlines",
      description: "Fetch stored outlines for a project.",
      inputSchema: {
        project_id: z.number().optional(),
      },
    },
    withToolResult(async ({ project_id }) => {
      const projectId = runtime.resolveId("projectId", project_id);
      const response = await http.post<Array<Record<string, unknown>>>("/outline/getOutline", { projectId });
      const outlines = response.data.map(normalizeOutline);
      if (outlines[0]) {
        runtime.remember({ projectId, outlineId: outlines[0].outlineId });
      }
      return {
        message: response.message,
        data: {
          projectId,
          outlines,
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_update_outline",
    {
      title: "Update Toonflow Outline",
      description: "Overwrite one outline row with edited outline JSON data.",
      inputSchema: {
        outline_id: z.number(),
        data: z.any(),
        project_id: z.number().optional(),
      },
    },
    withToolResult(async ({ outline_id, data, project_id }) => {
      const serialized = typeof data === "string" ? data : JSON.stringify(data);
      const response = await http.post("/outline/updateOutline", {
        id: outline_id,
        data: serialized,
      });

      let outline: ReturnType<typeof normalizeOutline> | null = null;
      if (project_id || runtime.snapshot.rememberedIds.projectId) {
        const projectId = runtime.resolveId("projectId", project_id);
        const outlinesResponse = await http.post<Array<Record<string, unknown>>>("/outline/getOutline", { projectId });
        outline = outlinesResponse.data.map(normalizeOutline).find((item) => item.outlineId === outline_id) || null;
        runtime.remember({ projectId, outlineId: outline_id });
      } else {
        runtime.remember({ outlineId: outline_id });
      }

      return {
        message: response.message,
        data: {
          outline,
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_get_scripts",
    {
      title: "Get Toonflow Scripts",
      description: "Fetch scripts for a project, optionally including linked asset elements.",
      inputSchema: {
        project_id: z.number().optional(),
        include_elements: z.boolean().optional(),
      },
    },
    withToolResult(async ({ project_id, include_elements }) => {
      const projectId = runtime.resolveId("projectId", project_id);
      const response = include_elements === false
        ? await http.post<Array<Record<string, unknown>>>("/outline/getPartScript", { projectId })
        : await http.post<Array<Record<string, unknown>>>("/script/geScriptApi", { projectId });

      const scripts = response.data.map(normalizeScript);
      if (scripts[0]) {
        runtime.remember({ projectId, scriptId: scripts[0].scriptId, outlineId: scripts[0].outlineId });
      }

      return {
        message: response.message,
        data: {
          projectId,
          scripts,
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_update_script",
    {
      title: "Update Toonflow Script",
      description: "Overwrite one script row with edited script content.",
      inputSchema: {
        script_id: z.number(),
        content: z.string(),
        project_id: z.number().optional(),
      },
    },
    withToolResult(async ({ script_id, content, project_id }) => {
      const response = await http.post("/outline/updateScript", {
        id: script_id,
        content,
      });

      let script: ReturnType<typeof normalizeScript> | null = null;
      if (project_id || runtime.snapshot.rememberedIds.projectId) {
        const projectId = runtime.resolveId("projectId", project_id);
        const scriptsResponse = await http.post<Array<Record<string, unknown>>>("/script/geScriptApi", { projectId });
        script = scriptsResponse.data.map(normalizeScript).find((item) => item.scriptId === script_id) || null;
        runtime.remember({
          projectId,
          scriptId: script_id,
          outlineId: script?.outlineId,
        });
      } else {
        runtime.remember({ scriptId: script_id });
      }

      return {
        message: response.message,
        data: {
          script,
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_generate_script",
    {
      title: "Generate Toonflow Script",
      description: "Generate a final script from an outline and an existing script row.",
      inputSchema: {
        outline_id: z.number(),
        script_id: z.number(),
        project_id: z.number().optional(),
      },
    },
    withToolResult(async ({ outline_id, script_id, project_id }) => {
      const response = await http.post("/script/generateScriptApi", {
        outlineId: outline_id,
        scriptId: script_id,
      });

      let script: ReturnType<typeof normalizeScript> | null = null;
      if (project_id || runtime.snapshot.rememberedIds.projectId) {
        const projectId = runtime.resolveId("projectId", project_id);
        const scriptsResponse = await http.post<Array<Record<string, unknown>>>("/script/geScriptApi", { projectId });
        script = scriptsResponse.data.map(normalizeScript).find((item) => item.scriptId === script_id) || null;
        runtime.remember({ projectId, outlineId: outline_id, scriptId: script_id });
      } else {
        runtime.remember({ outlineId: outline_id, scriptId: script_id });
      }

      return {
        message: response.message,
        data: {
          outlineId: outline_id,
          scriptId: script_id,
          script,
        },
      };
    }),
  );
}
