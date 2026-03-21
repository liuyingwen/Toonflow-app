import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ToonflowRuntimeConfig } from "../config";
import { ToonflowHttpClient } from "../client/http";
import { ToonflowWsSession } from "../client/ws";
import { withToolResult } from "../types";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeStoryboard(row: Record<string, unknown>) {
  return {
    storyboardId: Number(row.id),
    name: String(row.name || ""),
    description: String(row.intro || ""),
    prompt: String(row.prompt || ""),
    videoPrompt: String(row.videoPrompt || ""),
    filePath: String(row.filePath || ""),
    type: String(row.type || ""),
    scriptId: Number(row.scriptId),
    duration: row.duration == null || row.duration === "" ? null : Number(row.duration),
    segmentId: row.segmentId == null ? null : Number(row.segmentId),
    shotIndex: row.shotIndex == null ? null : Number(row.shotIndex),
    generatedImages: Array.isArray(row.generateImg) ? row.generateImg : [],
  };
}

async function sendStoryboardMessages(session: ToonflowWsSession, messages: string[], timeoutMs: number) {
  const responses: string[] = [];
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
      "Storyboard agent response timeout",
      cursor,
    );

    cursor = event.index;
    if (event.type === "error") {
      throw new Error(String(event.data || "Storyboard agent failed"));
    }
    responses.push(String(event.data || ""));
    await sleep(200);
    cursor = session.getLastIndex();
  }

  return responses;
}

export function registerStoryboardTools(server: McpServer, http: ToonflowHttpClient, runtime: ToonflowRuntimeConfig) {
  server.registerTool(
    "toonflow_upload_storyboard_image",
    {
      title: "Upload Toonflow Storyboard Image",
      description: "Upload a local/base64 storyboard reference image into Toonflow's project storage.",
      inputSchema: {
        project_id: z.number().optional(),
        base64_data: z.string(),
      },
    },
    withToolResult(async ({ project_id, base64_data }) => {
      const projectId = runtime.resolveId("projectId", project_id);
      const response = await http.post<string>("/storyboard/uploadImage", {
        projectId,
        base64Data: base64_data,
      });

      runtime.remember({ projectId });

      return {
        message: response.message,
        data: {
          projectId,
          url: response.data,
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_run_storyboard_agent",
    {
      title: "Run Toonflow Storyboard Agent",
      description: "Run Toonflow's storyboard WebSocket agent to generate segments and shots for a script.",
      inputSchema: {
        project_id: z.number().optional(),
        script_id: z.number().optional(),
        messages: z.array(z.string()).min(1),
        clear_history: z.boolean().optional(),
        replacements: z
          .array(
            z.object({
              segment_id: z.number(),
              cell_id: z.number(),
              cell: z.object({
                src: z.string().optional(),
                prompt: z.string().optional(),
                id: z.string().optional(),
              }),
            }),
          )
          .optional(),
        timeout_ms: z.number().optional(),
      },
    },
    withToolResult(async ({ project_id, script_id, messages, clear_history, replacements, timeout_ms }) => {
      const projectId = runtime.resolveId("projectId", project_id);
      const scriptId = runtime.resolveId("scriptId", script_id);
      const session = new ToonflowWsSession(runtime);
      const timeoutMs = timeout_ms ?? 120_000;

      try {
        await session.connect("/storyboard/chatStoryboard", { projectId, scriptId }, { timeoutMs, waitForInit: true });

        if (clear_history) {
          const cursor = session.getLastIndex();
          session.send({ type: "cleanHistory", data: null });
          await session.waitFor(
            (event) => event.type === "notice" || event.type === "error",
            10_000,
            "Storyboard cleanHistory timeout",
            cursor,
          );
        }

        if (replacements?.length) {
          let cursor = session.getLastIndex();
          for (const replacement of replacements) {
            session.send({
              type: "replaceShot",
              data: {
                segmentId: replacement.segment_id,
                cellId: replacement.cell_id,
                cell: replacement.cell,
              },
            });
            await sleep(100);
            cursor = session.getLastIndex();
          }
          await sleep(200);
          session.getLastIndex();
        }

        const responses = await sendStoryboardMessages(session, messages, timeoutMs);
        runtime.remember({ projectId, scriptId });

        return {
          message: "Storyboard agent completed",
          data: {
            projectId,
            scriptId,
            finalResponse: responses[responses.length - 1] || "",
            responses,
            latestSegments: session.getLatestEvent("segmentsUpdated")?.data ?? [],
            latestShots: session.getLatestEvent("shotsUpdated")?.data ?? [],
            events: session.getEvents(),
          },
        };
      } finally {
        await session.close();
      }
    }),
  );

  server.registerTool(
    "toonflow_generate_storyboard_image",
    {
      title: "Generate Toonflow Storyboard Image",
      description: "Generate a merged storyboard image from a segment's cells and prompts.",
      inputSchema: {
        project_id: z.number().optional(),
        script_id: z.number().optional(),
        segment_id: z.number(),
        title: z.string(),
        x: z.number(),
        y: z.number().nullable().optional(),
        cells: z.array(
          z.object({
            src: z.string().optional(),
            prompt: z.string(),
          }),
        ),
      },
    },
    withToolResult(async ({ project_id, script_id, segment_id, title, x, y, cells }) => {
      const projectId = runtime.resolveId("projectId", project_id);
      const scriptId = runtime.resolveId("scriptId", script_id);
      const response = await http.post<unknown>("/storyboard/generateShotImage", {
        projectId,
        scriptId,
        segmentId: segment_id,
        title,
        x,
        y: y ?? null,
        cells,
      });

      runtime.remember({ projectId, scriptId });

      return {
        message: response.message,
        data: {
          projectId,
          scriptId,
          segmentId: segment_id,
          image: response.data,
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_save_storyboards",
    {
      title: "Save Toonflow Storyboards",
      description: "Persist generated storyboard shots into Toonflow's asset table.",
      inputSchema: {
        results: z.array(
          z.object({
            video_prompt: z.string(),
            prompt: z.string(),
            duration: z.union([z.string(), z.number()]),
            project_id: z.number(),
            file_path: z.string(),
            name: z.string(),
            script_id: z.number(),
            segment_id: z.number(),
            shot_index: z.number(),
          }),
        ),
      },
    },
    withToolResult(async ({ results }) => {
      const response = await http.post("/storyboard/keepStoryboard", {
        results: results.map((item) => ({
          videoPrompt: item.video_prompt,
          prompt: item.prompt,
          duration: String(item.duration),
          projectId: item.project_id,
          filePath: item.file_path,
          type: "分镜",
          name: item.name,
          scriptId: item.script_id,
          segmentId: item.segment_id,
          shotIndex: item.shot_index,
        })),
      });

      if (results[0]) {
        runtime.remember({ projectId: results[0].project_id, scriptId: results[0].script_id });
      }

      return {
        message: typeof response.data === "object" && response.data && "message" in response.data
          ? String((response.data as { message?: unknown }).message || response.message)
          : response.message,
        data: {
          savedCount: results.length,
          projectId: results[0]?.project_id ?? null,
          scriptId: results[0]?.script_id ?? null,
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_edit_storyboard_image",
    {
      title: "Edit Toonflow Storyboard Image",
      description: "Edit a storyboard image with an image-editing prompt and optionally attach it back to an asset.",
      inputSchema: {
        project_id: z.number().optional(),
        prompt: z.string(),
        file_path: z.any(),
        asset_id: z.any().optional(),
      },
    },
    withToolResult(async ({ project_id, prompt, file_path, asset_id }) => {
      const projectId = runtime.resolveId("projectId", project_id);
      const response = await http.post<Record<string, unknown>>("/storyboard/storyboardImageEdit", {
        projectId,
        prompt,
        filePath: file_path,
        assetsId: asset_id,
      });

      runtime.remember({ projectId });

      return {
        message: response.message,
        data: {
          projectId,
          assetId: asset_id ?? null,
          imageId: response.data.id == null ? null : Number(response.data.id),
          url: response.data.url == null ? null : String(response.data.url),
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_batch_superscore_storyboard_images",
    {
      title: "Batch Superscore Toonflow Storyboard Images",
      description: "Run super-resolution on storyboard image cells and return the upgraded image URLs.",
      inputSchema: {
        project_id: z.number().optional(),
        script_id: z.number().optional().nullable(),
        image_list: z.array(
          z.object({
            cells: z.array(
              z.object({
                id: z.string(),
                prompt: z.string().optional(),
                src: z.string(),
              }),
            ),
          }),
        ),
      },
    },
    withToolResult(async ({ project_id, script_id, image_list }) => {
      const projectId = runtime.resolveId("projectId", project_id);
      const scriptId = script_id ?? runtime.snapshot.rememberedIds.scriptId ?? null;
      const response = await http.post<Array<Record<string, unknown>>>("/storyboard/batchSuperScoreImage", {
        projectId,
        scriptId,
        imageList: image_list,
      });

      runtime.remember({ projectId, scriptId: scriptId ?? undefined });

      return {
        message: response.message,
        data: {
          projectId,
          scriptId,
          images: response.data.map((item) => ({
            id: String(item.id || ""),
            projectId: Number(item.projectId),
            scriptId: item.scriptId == null ? null : Number(item.scriptId),
            filePath: String(item.filePath || ""),
            src: String(item.src || ""),
            type: String(item.type || ""),
          })),
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_get_storyboards",
    {
      title: "Get Toonflow Storyboards",
      description: "Fetch saved storyboard assets for a script.",
      inputSchema: {
        project_id: z.number().optional(),
        script_id: z.number().optional(),
      },
    },
    withToolResult(async ({ project_id, script_id }) => {
      const projectId = runtime.resolveId("projectId", project_id);
      const scriptId = runtime.resolveId("scriptId", script_id);
      const response = await http.post<Array<Record<string, unknown>>>("/storyboard/getStoryboard", {
        projectId,
        scriptId,
      });

      runtime.remember({ projectId, scriptId });

      return {
        message: response.message,
        data: {
          projectId,
          scriptId,
          storyboards: response.data.map(normalizeStoryboard),
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_generate_storyboard_motion_prompt",
    {
      title: "Generate Toonflow Storyboard Motion Prompt",
      description: "Generate a motion/video prompt for a single storyboard image.",
      inputSchema: {
        project_id: z.number().optional(),
        script_id: z.number().optional(),
        storyboard_id: z.union([z.string(), z.number()]),
        prompt: z.string().optional(),
        src: z.string(),
      },
    },
    withToolResult(async ({ project_id, script_id, storyboard_id, prompt, src }) => {
      const projectId = runtime.resolveId("projectId", project_id);
      const scriptId = runtime.resolveId("scriptId", script_id);
      const response = await http.post<Record<string, unknown>>("/storyboard/generateVideoPrompt", {
        projectId,
        scriptId,
        id: String(storyboard_id),
        prompt,
        src,
      });

      runtime.remember({ projectId, scriptId });

      return {
        message: response.message,
        data: {
          storyboardId: response.data.id ?? storyboard_id,
          videoPrompt: String(response.data.videoPrompt || ""),
          prompt: String(response.data.prompt || ""),
          duration: response.data.duration == null ? null : Number(response.data.duration),
          name: String(response.data.name || ""),
          src: String(response.data.src || src),
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_update_storyboard",
    {
      title: "Update Toonflow Storyboard",
      description: "Update storyboard prompt and duration metadata.",
      inputSchema: {
        storyboard_id: z.number(),
        prompt: z.string(),
        duration: z.union([z.string(), z.number()]),
      },
    },
    withToolResult(async ({ storyboard_id, prompt, duration }) => {
      const response = await http.post("/video/reviseVideoStoryboards", {
        storyboardId: storyboard_id,
        prompt,
        duration: String(duration),
      });

      return {
        message: typeof response.data === "object" && response.data && "message" in response.data
          ? String((response.data as { message?: unknown }).message || response.message)
          : response.message,
        data: {
          storyboardId: storyboard_id,
          prompt,
          duration: Number(duration),
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_save_storyboard_image",
    {
      title: "Save Toonflow Storyboard Image",
      description: "Select the final saved image for a storyboard.",
      inputSchema: {
        storyboard_id: z.number(),
        file_path: z.string(),
        prompt: z.string(),
      },
    },
    withToolResult(async ({ storyboard_id, file_path, prompt }) => {
      const response = await http.post("/storyboard/saveStoryboard", {
        id: storyboard_id,
        filePath: file_path,
        prompt,
      });

      return {
        message: typeof response.data === "object" && response.data && "message" in response.data
          ? String((response.data as { message?: unknown }).message || response.message)
          : response.message,
        data: {
          storyboardId: storyboard_id,
          filePath: file_path,
          prompt,
        },
      };
    }),
  );
}
