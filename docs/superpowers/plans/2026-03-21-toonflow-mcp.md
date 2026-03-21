# Toonflow MCP Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local stdio MCP server in this repository that exposes the complete Toonflow 漫剧制作 workflow through normalized tools over the existing HTTP and WebSocket backend.

**Architecture:** Add a dedicated `src/mcp` bridge layer that owns auth, HTTP calls, WebSocket session handling, and tool registration. Keep Toonflow business logic in the existing backend and make the MCP server a thin but structured adapter over it.

**Tech Stack:** TypeScript, Node.js, existing Express backend, WebSocket client, MCP SDK, Zod, tsx

---

## File Structure

### New files

- `src/mcp/server.ts` - stdio MCP entrypoint and tool registration
- `src/mcp/config.ts` - backend URL and token state handling
- `src/mcp/types.ts` - shared MCP response types
- `src/mcp/client/http.ts` - authenticated HTTP helper
- `src/mcp/client/ws.ts` - shared WebSocket session helper
- `src/mcp/tools/auth.ts` - login and model-binding tools
- `src/mcp/tools/project.ts` - project and novel tools
- `src/mcp/tools/outline.ts` - outline WS bridge and script tools
- `src/mcp/tools/assets.ts` - asset tools
- `src/mcp/tools/storyboard.ts` - storyboard WS bridge and persistence tools
- `src/mcp/tools/video.ts` - video tools
- `scripts/mcp-smoke.ts` - local smoke runner for the happy path

### Modified files

- `package.json` - add MCP dependencies and scripts

### Verification targets

- `yarn lint`
- `yarn mcp:smoke`

---

### Task 1: Add MCP runtime dependencies and scripts

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add MCP SDK and any small missing runtime dependency**

Add the MCP server dependency and a WebSocket client if one is not already present.

- [ ] **Step 2: Add development and smoke scripts**

Add scripts like:

```json
{
  "mcp:dev": "tsx src/mcp/server.ts",
  "mcp:smoke": "tsx scripts/mcp-smoke.ts"
}
```

- [ ] **Step 3: Run install if needed**

Run the package manager update needed to refresh the lockfile.

- [ ] **Step 4: Run typecheck**

Run: `yarn lint`
Expected: TypeScript compiles with the new dependency references resolved.

---

### Task 2: Create shared MCP config and backend client primitives

**Files:**
- Create: `src/mcp/config.ts`
- Create: `src/mcp/types.ts`
- Create: `src/mcp/client/http.ts`
- Create: `src/mcp/client/ws.ts`

- [ ] **Step 1: Define shared config shape**

Create a config module that stores:

- backend base URL
- bearer token
- optional remembered ids like `lastProjectId`

- [ ] **Step 2: Define normalized result helpers**

Create shared result types for:

- success payloads
- backend error payloads
- WS event logs

- [ ] **Step 3: Implement authenticated HTTP helper**

Support:

- automatic `Authorization` header
- JSON body requests
- normalized backend error parsing

- [ ] **Step 4: Implement shared WS helper**

Support:

- opening a session with token
- collecting ordered events
- timeout handling
- graceful close

- [ ] **Step 5: Run typecheck**

Run: `yarn lint`
Expected: New MCP support modules compile cleanly.

---

### Task 3: Implement auth and model binding tools

**Files:**
- Create: `src/mcp/tools/auth.ts`

- [ ] **Step 1: Add `toonflow_login`**

Call `POST /other/login`, cache the bearer token, and return normalized auth state.

- [ ] **Step 2: Add model-management tools**

Implement:

- `toonflow_get_model_bindings`
- `toonflow_add_model`
- `toonflow_update_model`
- `toonflow_bind_model`

- [ ] **Step 3: Normalize common setting payloads**

Make sure the caller sees:

- map key
- config id
- manufacturer
- model

- [ ] **Step 4: Run focused smoke calls if backend is up**

Use a small local script or direct invocation helper to verify login and binding calls.

- [ ] **Step 5: Run typecheck**

Run: `yarn lint`
Expected: Auth tool module compiles and exports clean tool definitions.

---

### Task 4: Implement project and novel tools

**Files:**
- Create: `src/mcp/tools/project.ts`

- [ ] **Step 1: Add project tools**

Implement:

- `toonflow_create_project`
- `toonflow_list_projects`
- `toonflow_get_project`

- [ ] **Step 2: Add novel tools**

Implement:

- `toonflow_import_novel`
- `toonflow_get_novel`

- [ ] **Step 3: Normalize ids in outputs**

Always expose:

- `projectId`
- chapter row ids
- chapter index values

- [ ] **Step 4: Run typecheck**

Run: `yarn lint`
Expected: Project and novel tool module compiles cleanly.

---

### Task 5: Implement outline WebSocket bridge and script tools

**Files:**
- Create: `src/mcp/tools/outline.ts`

- [ ] **Step 1: Implement `toonflow_run_outline_agent`**

Wrap `WS /outline/agentsOutline` and support sending one or more `msg` payloads.

- [ ] **Step 2: Collect and normalize outline events**

Capture:

- `stream`
- `response_end`
- `refresh`
- `toolCall`
- `error`

- [ ] **Step 3: Post-run fetch of persisted state**

After the WS flow, optionally fetch:

- storyline
- outlines
- scripts

This is required because script ids are created through the agent flow.

- [ ] **Step 4: Implement script tools**

Implement:

- `toonflow_get_storyline`
- `toonflow_get_outlines`
- `toonflow_get_scripts`
- `toonflow_generate_script`

- [ ] **Step 5: Verify the outline-to-script dependency path**

Manual check:

1. create project
2. import novel
3. run outline agent
4. confirm script rows exist
5. generate one script

- [ ] **Step 6: Run typecheck**

Run: `yarn lint`
Expected: Outline WS bridge compiles and returns typed results.

---

### Task 6: Implement asset tools

**Files:**
- Create: `src/mcp/tools/assets.ts`

- [ ] **Step 1: Implement asset lookup tools**

Implement:

- `toonflow_list_assets`
- `toonflow_get_asset_images`

- [ ] **Step 2: Implement asset prompt tool**

Implement:

- `toonflow_polish_asset_prompt`

- [ ] **Step 3: Implement asset image generation tool**

Implement:

- `toonflow_generate_asset_image`

This must operate on an existing asset record, not create asset metadata.

- [ ] **Step 4: Implement asset selection and update tools**

Implement:

- `toonflow_select_asset_image`
- `toonflow_update_asset`

- [ ] **Step 5: Verify the asset split**

Manual check:

1. outline agent creates asset rows
2. list assets returns them
3. polish one prompt
4. generate one image
5. select the generated image as primary

- [ ] **Step 6: Run typecheck**

Run: `yarn lint`
Expected: Asset tool module compiles and the generated output shape is stable.

---

### Task 7: Implement storyboard WebSocket bridge and persistence tools

**Files:**
- Create: `src/mcp/tools/storyboard.ts`

- [ ] **Step 1: Implement `toonflow_run_storyboard_agent`**

Wrap `WS /storyboard/chatStoryboard`.

- [ ] **Step 2: Normalize storyboard event streams**

Capture:

- `segmentsUpdated`
- `shotsUpdated`
- `shotImageGenerateStart`
- `shotImageGenerateProgress`
- `shotImageGenerateComplete`
- `error`

- [ ] **Step 3: Implement persistence and query tools**

Implement:

- `toonflow_save_storyboards`
- `toonflow_get_storyboards`

- [ ] **Step 4: Implement post-generation helpers**

Implement:

- `toonflow_generate_storyboard_motion_prompt`
- `toonflow_update_storyboard`
- `toonflow_save_storyboard_image`

- [ ] **Step 5: Note the route limitation in code comments**

Document that the backend WS message type `generateShotImage` is not the same as a complete persisted storyboard flow. Persistence still needs explicit HTTP save.

- [ ] **Step 6: Run storyboard smoke path**

Manual check:

1. start from a generated script
2. run storyboard agent
3. confirm segments and shots returned
4. persist with `toonflow_save_storyboards`
5. read back with `toonflow_get_storyboards`

- [ ] **Step 7: Run typecheck**

Run: `yarn lint`
Expected: Storyboard WS bridge compiles and event parsing is typed.

---

### Task 8: Implement video config and video generation tools

**Files:**
- Create: `src/mcp/tools/video.ts`

- [ ] **Step 1: Implement config tools**

Implement:

- `toonflow_create_video_config`
- `toonflow_update_video_config`
- `toonflow_list_video_configs`
- `toonflow_get_video_storyboards`

- [ ] **Step 2: Implement prompt-generation helper**

Implement:

- `toonflow_generate_video_prompt_batch`

- [ ] **Step 3: Implement video generation and polling**

Implement:

- `toonflow_generate_video`
- `toonflow_get_video`

Normalize `state` into readable statuses like:

- `pending`
- `succeeded`
- `failed`

- [ ] **Step 4: Verify async result handling**

Manual check:

1. create video config
2. generate video
3. poll until terminal state
4. surface `errorReason` on failure

- [ ] **Step 5: Run typecheck**

Run: `yarn lint`
Expected: Video tool module compiles and async polling is typed.

---

### Task 9: Register all MCP tools in the server entrypoint

**Files:**
- Create: `src/mcp/server.ts`

- [ ] **Step 1: Create stdio MCP server bootstrap**

Wire the SDK server and expose all tool modules.

- [ ] **Step 2: Register tools in stable groups**

Register:

- auth
- project
- outline
- assets
- storyboard
- video

- [ ] **Step 3: Add startup help text**

Make the entrypoint fail clearly if:

- base URL is missing
- login has not yet run for a token-required tool

- [ ] **Step 4: Run typecheck**

Run: `yarn lint`
Expected: The MCP entrypoint compiles with all tool registrations.

---

### Task 10: Add an end-to-end smoke runner

**Files:**
- Create: `scripts/mcp-smoke.ts`

- [ ] **Step 1: Implement a local happy-path script**

The script should:

1. login
2. create a small project
3. import minimal novel content
4. run outline agent
5. generate one script

This script can stop early before image and video generation if the local model config is unavailable, but it must validate the request flow.

- [ ] **Step 2: Add optional guarded deep smoke**

If required env vars or backend model bindings are present, continue through:

1. one asset image
2. one storyboard run
3. one video config
4. one video generation trigger

- [ ] **Step 3: Run the smoke script**

Run: `yarn mcp:smoke`
Expected: Happy path completes or exits with a clear guarded message about missing backend config.

---

### Task 11: Final verification and cleanup

**Files:**
- Modify: any files touched above

- [ ] **Step 1: Run full typecheck**

Run: `yarn lint`
Expected: PASS

- [ ] **Step 2: Run smoke verification**

Run: `yarn mcp:smoke`
Expected: PASS or guarded partial PASS with explicit reason

- [ ] **Step 3: Review tool names and docs for workflow clarity**

Make sure the MCP surface clearly separates:

- asset metadata generation
- asset image generation
- storyboard session generation
- storyboard persistence

- [ ] **Step 4: Review local-only assumptions**

Confirm the implementation assumes a local Toonflow instance and does not add unnecessary multi-tenant complexity.

