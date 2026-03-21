import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ToonflowRuntimeConfig } from "../config";
import { ToonflowHttpClient } from "../client/http";
import { withToolResult } from "../types";

type ModelType = "text" | "image" | "video";

interface ConfigRow {
  id: number;
  type: ModelType;
  model: string;
  baseUrl: string;
  apiKey: string;
  manufacturer: string;
  modelType: string;
  createTime?: number;
}

function normalizeConfig(row: Record<string, unknown>) {
  return {
    configId: Number(row.id),
    type: String(row.type) as ModelType,
    model: String(row.model || ""),
    baseUrl: String(row.baseUrl || ""),
    manufacturer: String(row.manufacturer || ""),
    modelType: String(row.modelType || ""),
    createTime: typeof row.createTime === "number" ? row.createTime : undefined,
  };
}

async function listConfiguredModels(http: ToonflowHttpClient, type?: ModelType) {
  const [nonVideo, video] = await Promise.all([
    type === "video" ? Promise.resolve([] as ConfigRow[]) : http.post<ConfigRow[]>("/setting/getSetting", {}),
    type && type !== "video" ? Promise.resolve([] as ConfigRow[]) : http.post<ConfigRow[]>("/setting/getVideoModelList", {}),
  ]);

  const merged = [
    ...(Array.isArray((nonVideo as { data?: unknown }).data) ? (nonVideo as { data: ConfigRow[] }).data : []),
    ...(Array.isArray((video as { data?: unknown }).data) ? (video as { data: ConfigRow[] }).data : []),
  ] as ConfigRow[];

  return merged
    .filter((item) => (type ? item.type === type : true))
    .map((item) => normalizeConfig(item as unknown as Record<string, unknown>))
    .sort((left, right) => right.configId - left.configId);
}

export function registerAuthTools(server: McpServer, http: ToonflowHttpClient, runtime: ToonflowRuntimeConfig) {
  server.registerTool(
    "toonflow_login",
    {
      title: "Toonflow Login",
      description: "Login to the local Toonflow backend and cache the JWT token for later tool calls.",
      inputSchema: {
        username: z.string(),
        password: z.string(),
        base_url: z.string().url().optional(),
      },
    },
    withToolResult(async ({ username, password, base_url }) => {
      if (base_url) {
        runtime.setBaseUrl(base_url);
      }

      const response = await http.post<{ token: string; name: string; id: number }>(
        "/other/login",
        { username, password },
        { auth: false },
      );

      runtime.setToken(response.data.token);
      runtime.setUser({
        id: response.data.id,
        name: response.data.name,
      });

      return {
        message: response.message,
        data: {
          baseUrl: runtime.baseUrl,
          wsBaseUrl: runtime.wsBaseUrl,
          token: runtime.token,
          user: runtime.user,
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_get_model_bindings",
    {
      title: "Get Toonflow Model Bindings",
      description: "Return current AI model bindings plus configured text/image/video models.",
      inputSchema: {
        type: z.enum(["text", "image", "video"]).optional(),
      },
    },
    withToolResult(async ({ type }) => {
      const [bindingsResponse, configuredModels] = await Promise.all([
        http.post<Array<Record<string, unknown>>>("/setting/getAiModelMap", {}),
        listConfiguredModels(http, type),
      ]);

      const bindings = bindingsResponse.data.map((row) => {
        const matchedConfig = configuredModels.find(
          (config) => config.model === String(row.model || "") && config.manufacturer === String(row.manufacturer || ""),
        );

        return {
          bindingId: Number(row.id),
          bindingName: String(row.name || ""),
          key: String(row.key || ""),
          model: String(row.model || ""),
          manufacturer: String(row.manufacturer || ""),
          configId: matchedConfig?.configId ?? null,
        };
      });

      return {
        message: "获取模型绑定成功",
        data: {
          bindings,
          configuredModels,
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_add_model",
    {
      title: "Add Toonflow Model",
      description: "Create a text, image, or video model config in Toonflow.",
      inputSchema: {
        type: z.enum(["text", "image", "video"]),
        model: z.string(),
        base_url: z.string().url(),
        api_key: z.string(),
        model_type: z.string(),
        manufacturer: z.string(),
      },
    },
    withToolResult(async ({ type, model, base_url, api_key, model_type, manufacturer }) => {
      const response = await http.post("/setting/addModel", {
        type,
        model,
        baseUrl: base_url,
        apiKey: api_key,
        modelType: model_type,
        manufacturer,
      });

      const configs = await listConfiguredModels(http, type);
      const createdConfig =
        configs.find(
          (item) =>
            item.type === type &&
            item.model === model &&
            item.baseUrl === base_url &&
            item.manufacturer === manufacturer &&
            item.modelType === model_type,
        ) || null;

      return {
        message: response.message,
        data: {
          config: createdConfig,
          configs,
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_update_model",
    {
      title: "Update Toonflow Model",
      description: "Update an existing Toonflow model config.",
      inputSchema: {
        config_id: z.number(),
        type: z.enum(["text", "image", "video"]),
        model: z.string(),
        base_url: z.string().url(),
        api_key: z.string(),
        model_type: z.string(),
        manufacturer: z.string(),
      },
    },
    withToolResult(async ({ config_id, type, model, base_url, api_key, model_type, manufacturer }) => {
      const response = await http.post("/setting/updateModel", {
        id: config_id,
        type,
        model,
        baseUrl: base_url,
        apiKey: api_key,
        modelType: model_type,
        manufacturer,
      });

      const configs = await listConfiguredModels(http, type);
      const updatedConfig = configs.find((item) => item.configId === config_id) || null;

      return {
        message: response.message,
        data: {
          config: updatedConfig,
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_bind_model",
    {
      title: "Bind Toonflow Model",
      description: "Bind a configured model to one of Toonflow's AI capability keys.",
      inputSchema: {
        binding_id: z.number(),
        config_id: z.number(),
      },
    },
    withToolResult(async ({ binding_id, config_id }) => {
      const response = await http.post("/setting/configurationModel", {
        id: binding_id,
        configId: config_id,
      });

      const bindingsResponse = await http.post<Array<Record<string, unknown>>>("/setting/getAiModelMap", {});
      const binding =
        bindingsResponse.data.find((item) => Number(item.id) === binding_id) ||
        null;

      return {
        message: response.message,
        data: {
          binding: binding
            ? {
                bindingId: Number(binding.id),
                bindingName: String(binding.name || ""),
                key: String(binding.key || ""),
                model: String(binding.model || ""),
                manufacturer: String(binding.manufacturer || ""),
                configId: config_id,
              }
            : null,
        },
      };
    }),
  );
}
