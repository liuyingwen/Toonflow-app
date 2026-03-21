import { inspect } from "util";

export interface ToonflowApiResponse<T = unknown> {
  code: number;
  data: T;
  message: string;
}

export interface ToonflowRequestResult<T = unknown> {
  status: number;
  message: string;
  data: T;
  raw: unknown;
}

export interface ToonflowWsEvent<T = unknown> {
  index: number;
  type: string;
  data: T;
  timestamp: string;
}

export class ToonflowHttpError extends Error {
  status: number;
  details: unknown;

  constructor(message: string, status = 500, details?: unknown) {
    super(message);
    this.name = "ToonflowHttpError";
    this.status = status;
    this.details = details;
  }
}

export function isToonflowApiResponse<T = unknown>(value: unknown): value is ToonflowApiResponse<T> {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ToonflowApiResponse<T>>;
  return typeof candidate.code === "number" && "data" in candidate && typeof candidate.message === "string";
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return "Unknown error";
}

function serializeDetails(details: unknown): Record<string, unknown> | undefined {
  if (details === undefined) return undefined;
  if (!details || typeof details !== "object") {
    return {
      value: details as string | number | boolean | null,
    };
  }

  return JSON.parse(
    JSON.stringify(details, (_key, value) => {
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack,
        };
      }
      return value;
    }),
  ) as Record<string, unknown>;
}

export function okResult<T>(message: string, data: T) {
  const payload = {
    ok: true,
    message,
    data,
  };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
  };
}

export function errorResult(message: string, details?: unknown, status?: number) {
  const payload = {
    ok: false,
    message,
    status,
    details: serializeDetails(details),
  };

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload,
    isError: true,
  };
}

export function withToolResult<TArgs, TData>(
  handler: (args: TArgs) => Promise<{ message: string; data: TData }>,
) {
  return async (args: TArgs) => {
    try {
      const result = await handler(args);
      return okResult(result.message, result.data);
    } catch (error) {
      if (error instanceof ToonflowHttpError) {
        return errorResult(error.message, error.details, error.status);
      }
      return errorResult(toErrorMessage(error), {
        error: inspect(error, { depth: 4 }),
      });
    }
  };
}
