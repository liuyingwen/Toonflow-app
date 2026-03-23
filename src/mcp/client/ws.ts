import WebSocket from "ws";
import { ToonflowRuntimeConfig } from "../config";
import { ToonflowWsEvent, toErrorMessage } from "../types";

type EventPredicate = (event: ToonflowWsEvent) => boolean;

interface PendingWaiter {
  afterIndex: number;
  predicate: EventPredicate;
  resolve: (event: ToonflowWsEvent) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export class ToonflowWsSession {
  private ws: WebSocket | null = null;
  private events: ToonflowWsEvent[] = [];
  private eventIndex = 0;
  private pending = new Set<PendingWaiter>();
  private closed = false;

  constructor(private readonly runtime: ToonflowRuntimeConfig) {}

  async connect(
    pathname: string,
    query: Record<string, string | number | boolean | null | undefined>,
    options: { timeoutMs?: number; waitForInit?: boolean } = {},
  ) {
    const timeoutMs = options.timeoutMs ?? 15_000;
    const ws = new WebSocket(this.runtime.buildWsUrl(pathname, query));
    this.ws = ws;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.removeAllListeners();
        ws.terminate();
        reject(new Error(`WebSocket connect timeout for ${pathname}`));
      }, timeoutMs);

      ws.once("open", () => {
        clearTimeout(timer);
        resolve();
      });

      ws.once("error", (error) => {
        clearTimeout(timer);
        ws.terminate();
        reject(error);
      });
    });

    ws.on("message", (raw) => {
      const text = raw.toString();
      let parsed: { type?: string; data?: unknown };

      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = {
          type: "parse_error",
          data: text,
        };
      }

      const event: ToonflowWsEvent = {
        index: ++this.eventIndex,
        type: parsed.type || "message",
        data: parsed.data,
        timestamp: new Date().toISOString(),
      };

      this.events.push(event);
      for (const waiter of [...this.pending]) {
        if (event.index > waiter.afterIndex && waiter.predicate(event)) {
          clearTimeout(waiter.timer);
          this.pending.delete(waiter);
          waiter.resolve(event);
        }
      }
    });

    ws.on("error", (error) => {
      for (const waiter of [...this.pending]) {
        clearTimeout(waiter.timer);
        waiter.reject(error instanceof Error ? error : new Error(toErrorMessage(error)));
        this.pending.delete(waiter);
      }
    });

    ws.on("close", () => {
      this.closed = true;
      for (const waiter of [...this.pending]) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("WebSocket closed before expected event arrived"));
        this.pending.delete(waiter);
      }
    });

    if (options.waitForInit) {
      await this.waitFor((event) => event.type === "init", timeoutMs, "WebSocket init event timeout");
    }
  }

  send(payload: unknown) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket is not connected");
    }
    this.ws.send(JSON.stringify(payload));
  }

  waitFor(predicate: EventPredicate, timeoutMs = 20_000, timeoutMessage = "WebSocket wait timeout", afterIndex = 0): Promise<ToonflowWsEvent> {
    const existing = this.events.find((event) => event.index > afterIndex && predicate(event));
    if (existing) {
      return Promise.resolve(existing);
    }

    return new Promise<ToonflowWsEvent>((resolve, reject) => {
      const waiter: PendingWaiter = {
        afterIndex,
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.pending.delete(waiter);
          reject(new Error(timeoutMessage));
        }, timeoutMs),
      };
      this.pending.add(waiter);
    });
  }

  getEvents(): ToonflowWsEvent[] {
    return [...this.events];
  }

  getLastIndex(): number {
    return this.eventIndex;
  }

  getLatestEvent(type: string): ToonflowWsEvent | undefined {
    return [...this.events].reverse().find((event) => event.type === type);
  }

  async close(code = 1000, timeoutMs = 3_000) {
    if (!this.ws || this.closed) return;
    const ws = this.ws;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        ws.removeAllListeners("close");
        ws.terminate();
        resolve();
      }, timeoutMs);
      ws.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      ws.close(code);
    });
  }
}
