import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ToonflowRuntimeConfig } from "../config";
import { ToonflowHttpClient } from "../client/http";
import { withToolResult } from "../types";

type VideoMode = "startEnd" | "multi" | "single" | "text";

interface VideoConfigRow {
  id: number;
  scriptId: number;
  projectId: number;
  aiConfigId: number;
  manufacturer: string;
  model: string;
  mode: VideoMode;
  startFrame: Record<string, unknown> | null;
  endFrame: Record<string, unknown> | null;
  images: Array<Record<string, unknown>>;
  resolution: string;
  duration: number;
  prompt: string;
  selectedResultId: number | null;
  createdAt: string;
  audioEnabled: boolean;
}

function normalizeVideoConfig(row: Record<string, unknown>) {
  return {
    videoConfigId: Number(row.id),
    scriptId: Number(row.scriptId),
    projectId: Number(row.projectId),
    aiConfigId: Number(row.aiConfigId),
    manufacturer: String(row.manufacturer || ""),
    model: String(row.model || ""),
    mode: String(row.mode || "") as VideoMode,
    startFrame: row.startFrame ?? null,
    endFrame: row.endFrame ?? null,
    images: Array.isArray(row.images) ? row.images : [],
    resolution: String(row.resolution || ""),
    duration: Number(row.duration || 0),
    prompt: String(row.prompt || ""),
    selectedResultId: row.selectedResultId == null ? null : Number(row.selectedResultId),
    createdAt: String(row.createdAt || ""),
    audioEnabled: Boolean(row.audioEnabled),
  };
}

function normalizeVideo(row: Record<string, unknown>) {
  return {
    videoId: Number(row.id),
    configId: row.configId == null ? null : Number(row.configId),
    scriptId: Number(row.scriptId),
    duration: row.time == null ? null : Number(row.time),
    resolution: String(row.resolution || ""),
    prompt: String(row.prompt || ""),
    firstFrame: String(row.firstFrame || ""),
    filePath: String(row.filePath || ""),
    storyboardImgs: Array.isArray(row.storyboardImgs) ? row.storyboardImgs : [],
    model: row.model == null ? null : String(row.model),
    state: Number(row.state),
    errorReason: row.errorReason == null ? null : String(row.errorReason),
  };
}

function nestedMessage(responseData: unknown, fallback: string) {
  if (responseData && typeof responseData === "object" && "message" in responseData) {
    const message = (responseData as { message?: unknown }).message;
    if (typeof message === "string" && message) {
      return message;
    }
  }
  return fallback;
}

export function registerVideoTools(server: McpServer, http: ToonflowHttpClient, runtime: ToonflowRuntimeConfig) {
  server.registerTool(
    "toonflow_delete_video_config",
    {
      title: "Delete Toonflow Video Config",
      description: "Delete a video config and all generated video results linked to it.",
      inputSchema: {
        video_config_id: z.number(),
      },
    },
    withToolResult(async ({ video_config_id }) => {
      const response = await http.post<Record<string, unknown>>("/video/deleteVideoConfig", {
        id: video_config_id,
      });

      return {
        message: nestedMessage(response.data, response.message),
        data: {
          deletedConfigId:
            response.data && typeof response.data === "object" && "deletedConfigId" in response.data
              ? Number((response.data as { deletedConfigId?: unknown }).deletedConfigId)
              : video_config_id,
          details: response.data,
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_create_video_config",
    {
      title: "Create Toonflow Video Config",
      description: "Create a video generation config for a storyboard script.",
      inputSchema: {
        project_id: z.number().optional(),
        script_id: z.number().optional(),
        config_id: z.number(),
        mode: z.enum(["startEnd", "multi", "single", "text"]),
        start_frame: z
          .object({
            id: z.number(),
            filePath: z.string(),
            prompt: z.string().optional(),
          })
          .nullable()
          .optional(),
        end_frame: z
          .object({
            id: z.number(),
            filePath: z.string(),
            prompt: z.string().optional(),
          })
          .nullable()
          .optional(),
        images: z
          .array(
            z.object({
              id: z.number(),
              filePath: z.string(),
              prompt: z.string().optional(),
            }),
          )
          .optional(),
        resolution: z.string(),
        duration: z.number(),
        prompt: z.string().optional(),
        audio_enabled: z.boolean(),
      },
    },
    withToolResult(async ({ project_id, script_id, config_id, mode, start_frame, end_frame, images, resolution, duration, prompt, audio_enabled }) => {
      const projectId = runtime.resolveId("projectId", project_id);
      const scriptId = runtime.resolveId("scriptId", script_id);
      const response = await http.post<Record<string, unknown>>("/video/addVideoConfig", {
        projectId,
        scriptId,
        configId: config_id,
        mode,
        startFrame: start_frame,
        endFrame: end_frame,
        images,
        resolution,
        duration,
        prompt,
        audioEnabled: audio_enabled,
      });

      const configPayload = response.data && typeof response.data === "object" && "data" in response.data
        ? (response.data as { data?: Record<string, unknown> }).data
        : null;

      const config = configPayload ? normalizeVideoConfig(configPayload) : null;
      if (config) {
        runtime.remember({
          projectId,
          scriptId,
          videoConfigId: config.videoConfigId,
        });
      }

      return {
        message: nestedMessage(response.data, response.message),
        data: {
          config,
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_update_video_config",
    {
      title: "Update Toonflow Video Config",
      description: "Update an existing video config.",
      inputSchema: {
        video_config_id: z.number(),
        resolution: z.string().optional(),
        duration: z.number().optional(),
        prompt: z.string().optional(),
        selected_result_id: z.number().nullable().optional(),
        start_frame: z.object({}).nullable().optional(),
        end_frame: z.object({}).nullable().optional(),
        images: z.array(z.object({})).optional(),
        audio_enabled: z.boolean().optional(),
      },
    },
    withToolResult(async ({ video_config_id, resolution, duration, prompt, selected_result_id, start_frame, end_frame, images, audio_enabled }) => {
      const response = await http.post<Record<string, unknown>>("/video/upDateVideoConfig", {
        id: video_config_id,
        resolution,
        duration,
        prompt,
        selectedResultId: selected_result_id,
        startFrame: start_frame,
        endFrame: end_frame,
        images,
        audioEnabled: audio_enabled,
      });

      const configPayload = response.data && typeof response.data === "object" && "data" in response.data
        ? (response.data as { data?: Record<string, unknown> }).data
        : null;
      const config = configPayload ? normalizeVideoConfig(configPayload) : null;
      if (config) {
        runtime.remember({
          projectId: config.projectId,
          scriptId: config.scriptId,
          videoConfigId: config.videoConfigId,
        });
      }

      return {
        message: nestedMessage(response.data, response.message),
        data: {
          config,
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_list_video_configs",
    {
      title: "List Toonflow Video Configs",
      description: "List video configs for a script.",
      inputSchema: {
        script_id: z.number().optional(),
      },
    },
    withToolResult(async ({ script_id }) => {
      const scriptId = runtime.resolveId("scriptId", script_id);
      const response = await http.post<Array<Record<string, unknown>>>("/video/getVideoConfigs", {
        scriptId,
      });

      const configs = response.data.map(normalizeVideoConfig);
      if (configs[0]) {
        runtime.remember({
          scriptId,
          projectId: configs[0].projectId,
          videoConfigId: configs[0].videoConfigId,
        });
      }

      return {
        message: response.message,
        data: {
          scriptId,
          configs,
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_generate_video_prompt_batch",
    {
      title: "Generate Toonflow Video Prompt Batch",
      description: "Generate a consolidated video prompt from multiple storyboard images.",
      inputSchema: {
        images: z.array(
          z.object({
            file_path: z.string(),
            prompt: z.string(),
          }),
        ),
        prompt: z.string(),
        duration: z.number(),
        mode: z.enum(["startEnd", "multi", "single", "text"]),
        video_config_id: z.number().optional(),
      },
    },
    withToolResult(async ({ images, prompt, duration, mode, video_config_id }) => {
      const response = await http.post<string>("/video/generatePrompt", {
        images: images.map((item) => ({
          filePath: item.file_path,
          prompt: item.prompt,
        })),
        prompt,
        duration,
        type: mode,
        videoConfigId: video_config_id,
      });

      if (video_config_id) {
        runtime.remember({ videoConfigId: video_config_id });
      }

      return {
        message: response.message,
        data: {
          prompt: response.data,
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_generate_video",
    {
      title: "Generate Toonflow Video",
      description: "Trigger asynchronous video generation for a storyboard script.",
      inputSchema: {
        project_id: z.number().optional(),
        script_id: z.number().optional(),
        config_id: z.number(),
        ai_config_id: z.number().optional(),
        type: z.string().optional(),
        resolution: z.string(),
        file_paths: z.array(z.string()).optional(),
        duration: z.number(),
        prompt: z.string(),
        mode: z.enum(["startEnd", "multi", "single", "text"]),
        audio_enabled: z.boolean(),
      },
    },
    withToolResult(async ({ project_id, script_id, config_id, ai_config_id, type, resolution, file_paths, duration, prompt, mode, audio_enabled }) => {
      const scriptId = runtime.resolveId("scriptId", script_id);
      const configsResponse = await http.post<Array<Record<string, unknown>>>("/video/getVideoConfigs", {
        scriptId,
      });
      const configs = configsResponse.data.map(normalizeVideoConfig);
      const matchedConfig = configs.find((item) => item.videoConfigId === config_id);
      if (!matchedConfig) {
        throw new Error(`Video config ${config_id} not found under script ${scriptId}.`);
      }

      const projectId = project_id ?? matchedConfig.projectId;
      const resolvedAiConfigId = ai_config_id ?? matchedConfig.aiConfigId;

      const response = await http.post<Record<string, unknown>>("/video/generateVideo", {
        projectId,
        scriptId,
        configId: config_id,
        type,
        resolution,
        aiConfigId: resolvedAiConfigId,
        filePath: file_paths ?? [],
        duration,
        prompt,
        mode,
        audioEnabled: audio_enabled,
      });

      runtime.remember({
        projectId,
        scriptId,
        videoConfigId: config_id,
        videoId: response.data.id == null ? undefined : Number(response.data.id),
      });

      return {
        message: response.message,
        data: {
          videoId: response.data.id == null ? null : Number(response.data.id),
          configId: response.data.configId == null ? config_id : Number(response.data.configId),
          projectId,
          scriptId,
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_save_video",
    {
      title: "Save Toonflow Video",
      description: "Mark one generated video result as the selected final video and persist its metadata.",
      inputSchema: {
        video_id: z.number(),
        file_path: z.string(),
        storyboard_imgs: z.array(z.string()).optional(),
        prompt: z.string().optional(),
        model: z.string().optional(),
        duration: z.number().optional(),
        resolution: z.string().optional(),
        script_id: z.number().optional(),
      },
    },
    withToolResult(async ({ video_id, file_path, storyboard_imgs, prompt, model, duration, resolution, script_id }) => {
      const response = await http.post("/video/saveVideo", {
        id: video_id,
        filePath: file_path,
        storyboardImgs: storyboard_imgs,
        prompt,
        model,
        time: duration,
        resolution,
      });

      let video: ReturnType<typeof normalizeVideo> | null = null;
      if (script_id || runtime.snapshot.rememberedIds.scriptId) {
        const scriptId = runtime.resolveId("scriptId", script_id);
        const videosResponse = await http.post<Array<Record<string, unknown>>>("/video/getVideo", {
          scriptId,
          specifyIds: [video_id],
        });
        video = videosResponse.data.map(normalizeVideo).find((item) => item.videoId === video_id) || null;
        runtime.remember({
          scriptId,
          videoId: video_id,
          videoConfigId: video?.configId ?? undefined,
        });
      } else {
        runtime.remember({ videoId: video_id });
      }

      return {
        message: nestedMessage(null, response.message),
        data: {
          video,
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_get_video",
    {
      title: "Get Toonflow Video",
      description: "Poll generated video records for a script.",
      inputSchema: {
        script_id: z.number().optional(),
        specify_ids: z.array(z.number()).optional(),
      },
    },
    withToolResult(async ({ script_id, specify_ids }) => {
      const scriptId = runtime.resolveId("scriptId", script_id);
      const response = await http.post<Array<Record<string, unknown>>>("/video/getVideo", {
        scriptId,
        specifyIds: specify_ids,
      });

      const videos = response.data.map(normalizeVideo);
      if (videos[0]) {
        runtime.remember({ scriptId, videoId: videos[0].videoId, videoConfigId: videos[0].configId ?? undefined });
      }

      return {
        message: response.message,
        data: {
          scriptId,
          videos,
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_get_video_storyboards",
    {
      title: "Get Toonflow Video Storyboards",
      description: "Get storyboard assets that can be used when configuring video generation.",
      inputSchema: {
        script_id: z.number().optional(),
      },
    },
    withToolResult(async ({ script_id }) => {
      const scriptId = runtime.resolveId("scriptId", script_id);
      const response = await http.post<Array<Record<string, unknown>>>("/video/getVideoStoryboards", {
        scriptId,
      });

      runtime.remember({ scriptId });

      return {
        message: response.message,
        data: {
          scriptId,
          storyboardGroups: response.data.map((item) => ({
            scriptId: Number(item.id),
            scriptName: String(item.scriptName || ""),
            storyboards: Array.isArray(item.storyboard)
              ? item.storyboard.map((storyboard: Record<string, unknown>) => ({
                  storyboardId: Number(storyboard.id),
                  name: String(storyboard.storyboardName || ""),
                  filePath: String(storyboard.filePath || ""),
                  prompt: String(storyboard.prompt || ""),
                  videoPrompt: String(storyboard.videoPrompt || ""),
                  duration: storyboard.duration == null ? null : Number(storyboard.duration),
                }))
              : [],
          })),
        },
      };
    }),
  );
}
