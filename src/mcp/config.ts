const DEFAULT_BASE_URL = process.env.TOONFLOW_MCP_BASE_URL || process.env.TOONFLOW_BASE_URL || "http://127.0.0.1:60000";

export interface ToonflowRuntimeSnapshot {
  baseUrl: string;
  wsBaseUrl: string;
  token: string | null;
  user: {
    id: number;
    name: string;
  } | null;
  rememberedIds: {
    projectId?: number;
    outlineId?: number;
    scriptId?: number;
    videoConfigId?: number;
    videoId?: number;
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function toWsBaseUrl(baseUrl: string): string {
  if (baseUrl.startsWith("https://")) {
    return `wss://${baseUrl.slice("https://".length)}`;
  }
  if (baseUrl.startsWith("http://")) {
    return `ws://${baseUrl.slice("http://".length)}`;
  }
  throw new Error(`Unsupported backend URL: ${baseUrl}`);
}

export class ToonflowRuntimeConfig {
  private snapshotValue: ToonflowRuntimeSnapshot;

  constructor(baseUrl = DEFAULT_BASE_URL) {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    this.snapshotValue = {
      baseUrl: normalizedBaseUrl,
      wsBaseUrl: toWsBaseUrl(normalizedBaseUrl),
      token: process.env.TOONFLOW_MCP_TOKEN || null,
      user: null,
      rememberedIds: {},
    };
  }

  get snapshot(): ToonflowRuntimeSnapshot {
    return {
      ...this.snapshotValue,
      rememberedIds: { ...this.snapshotValue.rememberedIds },
      user: this.snapshotValue.user ? { ...this.snapshotValue.user } : null,
    };
  }

  get baseUrl(): string {
    return this.snapshotValue.baseUrl;
  }

  get wsBaseUrl(): string {
    return this.snapshotValue.wsBaseUrl;
  }

  get token(): string | null {
    return this.snapshotValue.token;
  }

  get user() {
    return this.snapshotValue.user;
  }

  setBaseUrl(baseUrl: string) {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    this.snapshotValue.baseUrl = normalizedBaseUrl;
    this.snapshotValue.wsBaseUrl = toWsBaseUrl(normalizedBaseUrl);
  }

  setToken(token: string) {
    this.snapshotValue.token = token.startsWith("Bearer ") ? token : `Bearer ${token}`;
  }

  clearToken() {
    this.snapshotValue.token = null;
    this.snapshotValue.user = null;
  }

  setUser(user: { id: number; name: string } | null) {
    this.snapshotValue.user = user;
  }

  remember(ids: Partial<ToonflowRuntimeSnapshot["rememberedIds"]>) {
    this.snapshotValue.rememberedIds = {
      ...this.snapshotValue.rememberedIds,
      ...Object.fromEntries(Object.entries(ids).filter(([, value]) => value !== undefined)),
    };
  }

  resolveId(key: keyof ToonflowRuntimeSnapshot["rememberedIds"], fallback?: number | null): number {
    const resolved = fallback ?? this.snapshotValue.rememberedIds[key];
    if (typeof resolved !== "number" || Number.isNaN(resolved)) {
      throw new Error(`Missing required ${key}. Pass it explicitly or run the previous step first.`);
    }
    return resolved;
  }

  authHeaders(): Record<string, string> {
    if (!this.snapshotValue.token) {
      throw new Error("Toonflow token is missing. Call toonflow_login first.");
    }
    return {
      Authorization: this.snapshotValue.token,
    };
  }

  buildWsUrl(pathname: string, query: Record<string, string | number | boolean | null | undefined> = {}): string {
    const path = pathname.startsWith("/") ? pathname : `/${pathname}`;
    const url = new URL(`${this.snapshotValue.wsBaseUrl}${path}`);

    if (this.snapshotValue.token) {
      url.searchParams.set("token", this.snapshotValue.token);
    }

    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }

    return url.toString();
  }
}

export const runtimeConfig = new ToonflowRuntimeConfig();
