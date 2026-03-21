import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ToonflowRuntimeConfig } from "../config";
import { ToonflowHttpClient } from "../client/http";
import { withToolResult } from "../types";

interface ProjectRow {
  id: number;
  name: string;
  intro: string;
  type: string;
  artStyle: string;
  videoRatio: string;
  createTime?: number;
}

interface NovelRow {
  id: number;
  index: number;
  reel: string;
  chapter: string;
  chapterData: string;
}

function normalizeProject(row: ProjectRow) {
  return {
    projectId: row.id,
    name: row.name,
    intro: row.intro,
    type: row.type,
    artStyle: row.artStyle,
    videoRatio: row.videoRatio,
    createTime: row.createTime,
  };
}

function normalizeNovel(row: NovelRow) {
  return {
    id: row.id,
    index: row.index,
    reel: row.reel,
    chapter: row.chapter,
    chapterData: row.chapterData,
  };
}

export function registerProjectTools(server: McpServer, http: ToonflowHttpClient, runtime: ToonflowRuntimeConfig) {
  server.registerTool(
    "toonflow_create_project",
    {
      title: "Create Toonflow Project",
      description: "Create a new Toonflow project for a manga/drama production.",
      inputSchema: {
        project_type: z.string().optional(),
        name: z.string(),
        intro: z.string(),
        type: z.string(),
        art_style: z.string(),
        video_ratio: z.string(),
      },
    },
    withToolResult(async ({ project_type, name, intro, type, art_style, video_ratio }) => {
      const response = await http.post("/project/addProject", {
        projectType: project_type,
        name,
        intro,
        type,
        artStyle: art_style,
        videoRatio: video_ratio,
      });

      const projectsResponse = await http.post<ProjectRow[]>("/project/getProject", {});
      const project =
        [...projectsResponse.data]
          .sort((left, right) => (right.createTime || 0) - (left.createTime || 0))
          .find(
            (item) =>
              item.name === name &&
              item.intro === intro &&
              item.type === type &&
              item.artStyle === art_style &&
              item.videoRatio === video_ratio,
          ) || null;

      if (project) {
        runtime.remember({ projectId: project.id });
      }

      return {
        message: response.message,
        data: {
          project: project ? normalizeProject(project) : null,
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_list_projects",
    {
      title: "List Toonflow Projects",
      description: "List all Toonflow projects.",
      inputSchema: {},
    },
    withToolResult(async () => {
      const response = await http.post<ProjectRow[]>("/project/getProject", {});
      const projects = response.data.map(normalizeProject);
      if (projects[0]) {
        runtime.remember({ projectId: projects[0].projectId });
      }
      return {
        message: response.message,
        data: {
          projects,
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_get_project",
    {
      title: "Get Toonflow Project",
      description: "Fetch a single Toonflow project by id. If omitted, use the last remembered project id.",
      inputSchema: {
        project_id: z.number().optional(),
      },
    },
    withToolResult(async ({ project_id }) => {
      const projectId = runtime.resolveId("projectId", project_id);
      const response = await http.post<ProjectRow[]>("/project/getSingleProject", {
        id: projectId,
      });
      const project = response.data[0] ? normalizeProject(response.data[0]) : null;
      runtime.remember({ projectId });
      return {
        message: response.message,
        data: {
          project,
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_import_novel",
    {
      title: "Import Toonflow Novel",
      description: "Import source chapters into Toonflow.",
      inputSchema: {
        project_id: z.number().optional(),
        chapters: z.array(
          z.object({
            index: z.number(),
            reel: z.string(),
            chapter: z.string(),
            chapter_data: z.string(),
          }),
        ),
      },
    },
    withToolResult(async ({ project_id, chapters }) => {
      const projectId = runtime.resolveId("projectId", project_id);

      const response = await http.post("/novel/addNovel", {
        projectId,
        data: chapters.map((item) => ({
          index: item.index,
          reel: item.reel,
          chapter: item.chapter,
          chapterData: item.chapter_data,
        })),
      });

      const novelResponse = await http.post<NovelRow[]>("/novel/getNovel", {
        projectId,
      });

      runtime.remember({ projectId });

      return {
        message: response.message,
        data: {
          projectId,
          chapters: novelResponse.data.map(normalizeNovel),
        },
      };
    }),
  );

  server.registerTool(
    "toonflow_get_novel",
    {
      title: "Get Toonflow Novel",
      description: "Get imported novel chapters for a project.",
      inputSchema: {
        project_id: z.number().optional(),
      },
    },
    withToolResult(async ({ project_id }) => {
      const projectId = runtime.resolveId("projectId", project_id);
      const response = await http.post<NovelRow[]>("/novel/getNovel", {
        projectId,
      });

      runtime.remember({ projectId });

      return {
        message: response.message,
        data: {
          projectId,
          chapters: response.data.map(normalizeNovel),
        },
      };
    }),
  );
}
