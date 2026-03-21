# Toonflow MCP Design

**Date:** 2026-03-21

## Goal

Build a local MCP server inside this repository that exposes the complete Toonflow "漫剧制作" workflow as structured tools. The MCP layer should reuse the existing Toonflow backend instead of reimplementing story, script, asset, storyboard, or video logic.

## Context

This repository already contains a working Express backend with SQLite persistence. The backend is not a generic public API. It is a local application backend with:

- JWT auth on almost every route
- mixed HTTP and WebSocket workflows
- SQLite-backed stateful records for project, novel, outline, script, assets, storyboard, video, and model configuration
- business logic split between normal routes and in-process agent tools

The MCP server should be treated as a bridge over the existing backend, not as a replacement for it.

## Existing Backend Facts

### Auth

- `POST /other/login` returns `Bearer <jwt>`
- all other routes require JWT in `Authorization` or `?token=`
- current implementation is effectively single-user for local usage

### Workflow split

- plain CRUD and generation triggers are available over HTTP
- story generation and storyboard generation depend on WebSocket agents
- some critical data creation only happens inside those agents

### Critical constraints

1. `POST /outline/addOutline` only inserts outline rows. It does not create `t_script` rows.
2. `POST /script/generateScriptApi` requires both `outlineId` and `scriptId`.
3. asset metadata generation from outline is not exposed as a standalone HTTP route.
4. storyboard segment and shot generation are not exposed as standalone HTTP routes.

These constraints mean the MCP server must support WebSocket bridging for a complete workflow.

## Scope

The MCP server will expose tools for:

- login and model binding
- project creation and lookup
- novel import and lookup
- outline/storyline generation over WebSocket
- script generation
- asset prompt polishing and image generation
- storyboard generation over WebSocket
- storyboard persistence and lookup
- video prompt generation
- video config creation and update
- video generation and polling

The MCP server will not expose:

- destructive admin tools like database wipe routes
- old or redundant routes that do not contribute to the main production workflow
- direct database access

## Recommended Architecture

### Option A: Embedded MCP bridge inside this repo

Run a separate stdio MCP server process from this repository. The server talks to Toonflow over HTTP and WebSocket and returns normalized tool outputs.

Pros:

- minimal business logic duplication
- easiest to keep aligned with existing backend behavior
- simplest local deployment model

Cons:

- MCP behavior depends on backend process availability
- some tool results remain backend-shaped unless normalized

### Option B: Reimplement missing workflow in the MCP layer

Use only HTTP routes and recreate outline asset extraction and storyboard generation logic inside MCP.

Pros:

- fewer WebSocket moving parts

Cons:

- duplicates business rules already encoded in agents
- higher drift risk
- loses parity with the UI workflow

### Option C: Call internal modules directly instead of backend routes

Import Toonflow internals into the MCP process and bypass HTTP for some steps.

Pros:

- fewer network hops

Cons:

- much tighter coupling
- harder startup lifecycle
- mixed invocation model is harder to maintain

### Recommendation

Use **Option A**. Keep the MCP server as a clean adapter over the current backend. Use HTTP for CRUD-style steps and WebSocket for the two agent-driven stages:

- outline/storyline generation
- storyboard generation

## MCP Tool Surface

### Authentication and model setup

- `toonflow_login`
- `toonflow_get_model_bindings`
- `toonflow_add_model`
- `toonflow_update_model`
- `toonflow_bind_model`

### Project and source material

- `toonflow_create_project`
- `toonflow_list_projects`
- `toonflow_get_project`
- `toonflow_import_novel`
- `toonflow_get_novel`

### Outline and storyline

- `toonflow_run_outline_agent`
- `toonflow_get_storyline`
- `toonflow_get_outlines`
- `toonflow_get_scripts`
- `toonflow_generate_script`

### Assets

- `toonflow_list_assets`
- `toonflow_polish_asset_prompt`
- `toonflow_generate_asset_image`
- `toonflow_get_asset_images`
- `toonflow_select_asset_image`
- `toonflow_update_asset`

### Storyboards

- `toonflow_run_storyboard_agent`
- `toonflow_save_storyboards`
- `toonflow_get_storyboards`
- `toonflow_generate_storyboard_motion_prompt`
- `toonflow_update_storyboard`
- `toonflow_save_storyboard_image`

### Video

- `toonflow_create_video_config`
- `toonflow_update_video_config`
- `toonflow_list_video_configs`
- `toonflow_generate_video_prompt_batch`
- `toonflow_generate_video`
- `toonflow_get_video`
- `toonflow_get_video_storyboards`

## Tool Behavior Design

### `toonflow_run_outline_agent`

This tool must own the full WebSocket session lifecycle for `WS /outline/agentsOutline`.

Input:

- `project_id`
- `messages`
- optional `mode` such as `storyline`, `outline`, `assets`

Behavior:

- open WS connection
- send one or more `msg` payloads
- collect streamed events
- return structured output with:
  - raw event log
  - final response text
  - refresh events
  - optional current storyline
  - optional current outline list
  - optional current scripts

Why:

- the backend outline agent creates scripts and can generate asset metadata
- MCP callers should not need to manually reason about the event stream

### `toonflow_generate_script`

Input:

- `outline_id`
- `script_id`

Behavior:

- call `POST /script/generateScriptApi`
- then fetch script state via `POST /outline/getPartScript` or `POST /script/geScriptApi`
- return both action status and updated script payload

### `toonflow_generate_asset_image`

Input:

- `asset_id`
- `project_id`
- `asset_type` in Toonflow terms: `role | scene | props | storyboard`
- `name`
- `prompt`
- optional `base64`

Behavior:

- call `POST /assets/generateAssets`
- normalize returned path and asset id

Important:

- this tool only generates images for an existing asset record
- it does not create asset metadata from outline

### `toonflow_run_storyboard_agent`

This tool must own the full WebSocket session lifecycle for `WS /storyboard/chatStoryboard`.

Input:

- `project_id`
- `script_id`
- `messages`
- optional `replace_shot`

Behavior:

- open WS connection
- send `msg` events
- collect `segmentsUpdated`, `shotsUpdated`, `shotImageGenerate*`
- return:
  - raw event log
  - latest segments
  - latest in-memory shots
  - final response text

Important:

- generated shots are in session memory first
- they are not automatically persisted as `t_assets`

### `toonflow_save_storyboards`

Input:

- normalized storyboard result array

Behavior:

- call `POST /storyboard/keepStoryboard`
- persist shot results into `t_assets`

This tool is the handoff point from WS in-memory state to HTTP-backed persistent state.

### `toonflow_generate_video`

Input:

- `project_id`
- `script_id`
- `config_id`
- `resolution`
- `duration`
- `prompt`
- `mode`
- `audio_enabled`
- `file_path[]`

Behavior:

- call `POST /video/generateVideo`
- return `video_id`
- do not wait synchronously for final mp4

Callers must then use `toonflow_get_video` to poll `state`.

## State and Session Strategy

The MCP server should support both:

- stateless invocation where the caller passes all required ids
- session-assisted invocation where the server can remember:
  - backend base URL
  - JWT token
  - default project id

Recommended session memory:

- `base_url`
- `token`
- `last_project_id`
- `last_script_id`
- `last_video_config_id`

The server should not hide ids completely. It should remember them to reduce friction, but tool outputs must still expose them clearly.

## Error Handling

### Normalize backend failures

The backend mixes:

- HTTP status codes
- `{ code, data, message }`
- raw error objects
- WS event-level `error`

The MCP server should normalize all failures into a standard tool error shape:

- `step`
- `backend_status`
- `backend_message`
- `details`

### Required special handling

- missing login token
- missing model binding
- outline agent finished without creating scripts
- storyboard agent finished without shots
- image generation returned path but no file selected
- video generation returned id but later polling shows `state = -1`

## Verification Strategy

### Minimum manual smoke path

1. login
2. create project
3. import novel
4. run outline agent to create outline and scripts
5. generate one script
6. generate one asset image
7. run storyboard agent for one script
8. save one storyboard
9. create one video config
10. generate one video
11. poll until success or failure

### Required code-level checks

- schema validation for each MCP tool input
- normalized parsing of Toonflow success payloads
- WS event parsing and timeouts
- id propagation across steps

## Risks

### Risk 1: WS flow instability

The two agent endpoints stream multiple event types and have implicit state. The MCP bridge must:

- buffer ordered events
- detect terminal conditions
- tolerate partial streams

### Risk 2: Outline-to-script dependency

If callers bypass the outline agent and insert outlines manually, `script_id` creation breaks. The MCP UX should steer users toward the outline agent path.

### Risk 3: Asset generation misunderstanding

There are two distinct steps:

- create asset records
- generate asset images

The tool naming and docs must keep these separate.

### Risk 4: Legacy routes

Some routes are old or redundant. The MCP layer should expose only the routes needed for the main workflow, not every backend endpoint.

## Design Decision Summary

- build an embedded local stdio MCP server
- use HTTP for CRUD and async generation triggers
- use WebSocket bridges for outline and storyboard agent workflows
- expose explicit tools for asset metadata versus asset image generation
- keep ids visible in outputs and optionally cached in session state
- prefer normalized, workflow-oriented MCP tools over thin one-to-one route wrappers

## Proposed File Layout

- `src/mcp/server.ts` - MCP server entrypoint
- `src/mcp/config.ts` - base URL and token config handling
- `src/mcp/client/http.ts` - authenticated HTTP client
- `src/mcp/client/ws.ts` - WebSocket session helpers
- `src/mcp/types.ts` - normalized MCP-side result types
- `src/mcp/tools/auth.ts` - login and model binding tools
- `src/mcp/tools/project.ts` - project and novel tools
- `src/mcp/tools/outline.ts` - outline agent and script tools
- `src/mcp/tools/assets.ts` - asset tools
- `src/mcp/tools/storyboard.ts` - storyboard tools
- `src/mcp/tools/video.ts` - video tools
- `scripts/mcp-smoke.ts` - local smoke test script

## Ready State

This design is ready to turn into an implementation plan.
