import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ToonflowRuntimeConfig } from "../config";
import { ToonflowHttpClient } from "../client/http";
import { withToolResult } from "../types";

type AssetToolType = "role" | "scene" | "props" | "storyboard";

const assetTypeMap: Record<AssetToolType, string> = {
  role: "角色",
  scene: "场景",
  props: "道具",
  storyboard: "分镜",
};

function normalizeAssetType(type: string): AssetToolType {
  if (type === "角色") return "role";
  if (type === "场景") return "scene";
  if (type === "道具") return "props";
  return "storyboard";
}

function normalizeAsset(row: Record<string, unknown>) {
  return {
    assetId: Number(row.id),
    projectId: Number(row.projectId),
    scriptId: row.scriptId == null ? null : Number(row.scriptId),
    assetType: normalizeAssetType(String(row.type || "")),
    rawType: String(row.type || ""),
    name: String(row.name || ""),
    description: String(row.intro || ""),
    prompt: String(row.prompt || ""),
    videoPrompt: row.videoPrompt == null ? null : String(row.videoPrompt),
    remark: row.remark == null ? null : String(row.remark),
    duration: row.duration == null || row.duration === "" ? null : Number(row.duration),
    filePath: String(row.filePath || ""),
    state: row.state == null ? null : String(row.state),
    segmentId: row.segmentId == null ? null : Number(row.segmentId),
    shotIndex: row.shotIndex == null ? null : Number(row.shotIndex),
  };
}

export function registerAssetTools(server: McpServer, http: ToonflowHttpClient, runtime: ToonflowRuntimeConfig) {
  server.registerTool(
    "toonflow_add_asset",
    {
      title: "Add Toonflow Asset",
      description: "Create a manual asset record when outline-generated metadata is missing or needs supplementation.",
      inputSchema: {
        project_id: z.number().optional(),
        script_id: z.number().optional(),
        asset_type: z.enum(["role", "scene", "props", "storyboard"]),
        name: z.string(),
        description: z.string(),
        prompt: z.string(),
        remark: z.string().optional(),
        episode: z.string().optional(),
      },
    },
    withToolResult(async ({ project_id, script_id, asset_type, name, description, prompt, remark, episode }) => {
      const projectId = runtime.resolveId("projectId", project_id);
      const resolvedScriptId = script_id ?? runtime.snapshot.rememberedIds.scriptId ?? null;

      const response = await http.post("/assets/addAssets", {
        projectId,
        scriptId: resolvedScriptId,
        name,
        intro: description,
        type: assetTypeMap[asset_type],
        prompt,
        remark,
        episode,
      });

      const assetsResponse = await http.post<Array<Record<string, unknown>>>("/assets/getAssets", {
        projectId,
        type: assetTypeMap[asset_type],
      });

      const asset =
        assetsResponse.data
          .map(normalizeAsset)
          .sort((left, right) => right.assetId - left.assetId)
          .find(
            (item) =>
              item.name === name &&
              item.description === description &&
              item.prompt === prompt &&
              item.assetType === asset_type &&
              item.scriptId === resolvedScriptId,
          ) || null;

      runtime.remember({ projectId, scriptId: resolvedScriptId ?? undefined });

      return {
        message: response.message,
        data: {
          asset,
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_delete_asset_image",
    {
      title: "Delete Toonflow Asset Image",
      description: "Delete a generated asset image candidate or clear the final selected asset image.",
      inputSchema: {
        image_id: z.number().optional(),
        asset_id: z.number().optional(),
      },
    },
    withToolResult(async ({ image_id, asset_id }) => {
      if (!image_id && !asset_id) {
        throw new Error("Either image_id or asset_id is required.");
      }

      const response = await http.post("/assets/delAssetsImage", {
        imageId: image_id,
        assetsId: asset_id,
      });

      let imageState: Record<string, unknown> | null = null;
      if (asset_id) {
        const stateResponse = await http.post<Record<string, unknown>>("/assets/getImage", {
          assetsId: asset_id,
        });
        imageState = {
          assetId: Number(stateResponse.data.id),
          state: String(stateResponse.data.state || ""),
          filePath: String(stateResponse.data.filePath || ""),
          generatedImages: Array.isArray(stateResponse.data.tempAssets) ? stateResponse.data.tempAssets : [],
        };
      }

      return {
        message: response.message,
        data: {
          assetId: asset_id ?? null,
          imageId: image_id ?? null,
          imageState,
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_list_assets",
    {
      title: "List Toonflow Assets",
      description: "List assets for a project by asset type.",
      inputSchema: {
        project_id: z.number().optional(),
        asset_type: z.enum(["role", "scene", "props", "storyboard"]),
      },
    },
    withToolResult(async ({ project_id, asset_type }) => {
      const projectId = runtime.resolveId("projectId", project_id);
      const response = await http.post<Array<Record<string, unknown>>>("/assets/getAssets", {
        projectId,
        type: assetTypeMap[asset_type],
      });
      runtime.remember({ projectId });
      return {
        message: response.message,
        data: {
          projectId,
          assetType: asset_type,
          assets: response.data.map(normalizeAsset),
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_get_asset_images",
    {
      title: "Get Toonflow Asset Images",
      description: "Get selected and generated images for a single asset.",
      inputSchema: {
        asset_id: z.number(),
      },
    },
    withToolResult(async ({ asset_id }) => {
      const response = await http.post<Record<string, unknown>>("/assets/getImage", {
        assetsId: asset_id,
      });

      return {
        message: response.message,
        data: {
          assetId: Number(response.data.id),
          state: String(response.data.state || ""),
          filePath: String(response.data.filePath || ""),
          scriptId: response.data.scriptId == null ? null : Number(response.data.scriptId),
          generatedImages: Array.isArray(response.data.tempAssets)
            ? response.data.tempAssets.map((item: Record<string, unknown>) => ({
                id: Number(item.id),
                assetId: Number(item.assetsId),
                type: String(item.type || ""),
                state: String(item.state || ""),
                filePath: String(item.filePath || ""),
              }))
            : [],
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_polish_asset_prompt",
    {
      title: "Polish Toonflow Asset Prompt",
      description: "Generate an improved asset prompt from Toonflow's asset prompt tool.",
      inputSchema: {
        asset_id: z.number(),
        project_id: z.number().optional(),
        asset_type: z.enum(["role", "scene", "props", "storyboard"]),
        name: z.string(),
        description: z.string(),
      },
    },
    withToolResult(async ({ asset_id, project_id, asset_type, name, description }) => {
      const projectId = runtime.resolveId("projectId", project_id);
      const response = await http.post<Record<string, unknown>>("/assets/polishAssetsPrompt", {
        assetsId: asset_id,
        projectId,
        type: asset_type,
        name,
        describe: description,
      });

      runtime.remember({ projectId });

      return {
        message: response.message,
        data: {
          assetId: Number(response.data.assetsId || asset_id),
          prompt: String(response.data.prompt || ""),
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_generate_asset_image",
    {
      title: "Generate Toonflow Asset Image",
      description: "Generate an image for an existing Toonflow asset.",
      inputSchema: {
        asset_id: z.number(),
        project_id: z.number().optional(),
        asset_type: z.enum(["role", "scene", "props", "storyboard"]),
        name: z.string(),
        prompt: z.string(),
        base64: z.string().optional(),
      },
    },
    withToolResult(async ({ asset_id, project_id, asset_type, name, prompt, base64 }) => {
      const projectId = runtime.resolveId("projectId", project_id);
      const response = await http.post<Record<string, unknown>>("/assets/generateAssets", {
        id: asset_id,
        type: asset_type,
        projectId,
        name,
        prompt,
        base64,
      });
      const imageState = await http.post<Record<string, unknown>>("/assets/getImage", {
        assetsId: asset_id,
      });

      runtime.remember({ projectId });

      return {
        message: response.message,
        data: {
          assetId: Number(response.data.assetsId || asset_id),
          generatedPath: String(response.data.path || ""),
          imageState: {
            assetId: Number(imageState.data.id),
            state: String(imageState.data.state || ""),
            filePath: String(imageState.data.filePath || ""),
            generatedImages: Array.isArray(imageState.data.tempAssets) ? imageState.data.tempAssets : [],
          },
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_select_asset_image",
    {
      title: "Select Toonflow Asset Image",
      description: "Select or upload the final image for an asset.",
      inputSchema: {
        asset_id: z.number(),
        project_id: z.number().optional(),
        file_path: z.string().optional(),
        base64: z.string().optional(),
        prompt: z.string().optional(),
      },
    },
    withToolResult(async ({ asset_id, project_id, file_path, base64, prompt }) => {
      if (!file_path && !base64) {
        throw new Error("Either file_path or base64 is required.");
      }

      const projectId = base64 ? runtime.resolveId("projectId", project_id) : project_id ?? runtime.snapshot.rememberedIds.projectId ?? 0;

      const response = await http.post("/assets/saveAssets", {
        id: asset_id,
        projectId,
        filePath: file_path,
        base64,
        prompt,
      });

      const imageState = await http.post<Record<string, unknown>>("/assets/getImage", {
        assetsId: asset_id,
      });

      if (projectId) {
        runtime.remember({ projectId });
      }

      return {
        message: response.message,
        data: {
          assetId: asset_id,
          imageState: {
            assetId: Number(imageState.data.id),
            state: String(imageState.data.state || ""),
            filePath: String(imageState.data.filePath || ""),
            generatedImages: Array.isArray(imageState.data.tempAssets) ? imageState.data.tempAssets : [],
          },
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_update_asset",
    {
      title: "Update Toonflow Asset",
      description: "Update asset metadata such as name, description, prompt, and video prompt.",
      inputSchema: {
        asset_id: z.number(),
        project_id: z.number().optional(),
        asset_type: z.enum(["role", "scene", "props", "storyboard"]),
        name: z.string(),
        description: z.string(),
        prompt: z.string(),
        video_prompt: z.string().optional(),
        remark: z.string().optional(),
        duration: z.number().optional(),
      },
    },
    withToolResult(async ({ asset_id, project_id, asset_type, name, description, prompt, video_prompt, remark, duration }) => {
      const response = await http.post("/assets/updateAssets", {
        id: asset_id,
        name,
        intro: description,
        type: assetTypeMap[asset_type],
        prompt,
        videoPrompt: video_prompt,
        remark,
        duration,
      });

      let asset: ReturnType<typeof normalizeAsset> | null = null;
      if (project_id || runtime.snapshot.rememberedIds.projectId) {
        const projectId = runtime.resolveId("projectId", project_id);
        const assets = await http.post<Array<Record<string, unknown>>>("/assets/getAssets", {
          projectId,
          type: assetTypeMap[asset_type],
        });
        asset = assets.data.map(normalizeAsset).find((item) => item.assetId === asset_id) || null;
        runtime.remember({ projectId });
      }

      return {
        message: response.message,
        data: {
          assetId: asset_id,
          asset,
        },
      };
    }),
  );
}
