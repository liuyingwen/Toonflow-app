import axios, { AxiosRequestConfig } from "axios";
import { ToonflowRuntimeConfig } from "../config";
import { ToonflowHttpError, ToonflowRequestResult, isToonflowApiResponse } from "../types";

function extractMessage(payload: unknown, fallback: string): string {
  if (typeof payload === "string") return payload;
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return fallback;
}

export class ToonflowHttpClient {
  constructor(private readonly runtime: ToonflowRuntimeConfig) {}

  async post<TData = unknown>(
    pathname: string,
    body: Record<string, unknown>,
    options: { auth?: boolean } = {},
  ): Promise<ToonflowRequestResult<TData>> {
    const config: AxiosRequestConfig = {
      method: "post",
      url: pathname.startsWith("/") ? pathname : `/${pathname}`,
      baseURL: this.runtime.baseUrl,
      data: body,
      validateStatus: () => true,
      headers: {
        "Content-Type": "application/json",
        ...(options.auth === false ? {} : this.runtime.authHeaders()),
      },
    };

    const response = await axios.request(config);
    const payload = response.data;

    if (response.status < 200 || response.status >= 300) {
      throw new ToonflowHttpError(extractMessage(payload, `HTTP ${response.status}`), response.status, payload);
    }

    if (isToonflowApiResponse<TData>(payload)) {
      if (payload.code !== 200) {
        throw new ToonflowHttpError(payload.message || "Backend request failed", response.status, payload);
      }

      return {
        status: response.status,
        message: payload.message,
        data: payload.data,
        raw: payload,
      };
    }

    return {
      status: response.status,
      message: extractMessage(payload, "成功"),
      data: payload as TData,
      raw: payload,
    };
  }
}
