import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import { join } from "node:path";
import { getEnv } from "@/lib/env";

export type SmartTurnRequest = {
  audioPcm16Base64: string;
  sampleRate: number;
  durationMs: number;
};

export type SmartTurnResult = {
  complete: boolean;
  probability: number;
  source: "smart-turn-endpoint" | "smart-turn-python" | "vad-fallback" | "disabled";
  reason?: string;
};

type WorkerResponse = {
  id?: string;
  complete?: boolean;
  probability?: number;
  source?: string;
  error?: string;
};

type PendingRequest = {
  resolve: (result: SmartTurnResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

let worker: SmartTurnWorker | null = null;
let pythonUnavailableReason: string | null = null;

export async function analyzeSmartTurn(request: SmartTurnRequest): Promise<SmartTurnResult> {
  const env = getEnv();

  if (env.SMART_TURN_MODE === "off") {
    return disabledTurnResult("SMART_TURN_MODE=off");
  }

  if (env.SMART_TURN_ENDPOINT) {
    try {
      return await analyzeWithRemoteEndpoint(env.SMART_TURN_ENDPOINT, request, env.SMART_TURN_TIMEOUT_MS);
    } catch (error) {
      return fallbackTurnResult(request, getErrorMessage(error));
    }
  }

  if (!pythonUnavailableReason) {
    try {
      return await getSmartTurnWorker(env.SMART_TURN_PYTHON, env.SMART_TURN_TIMEOUT_MS).analyze(
        request,
        env.SMART_TURN_TIMEOUT_MS
      );
    } catch (error) {
      pythonUnavailableReason = getErrorMessage(error);
    }
  }

  return fallbackTurnResult(request, pythonUnavailableReason ?? "Smart Turn worker unavailable.");
}

async function analyzeWithRemoteEndpoint(
  endpoint: string,
  request: SmartTurnRequest,
  timeoutMs: number
): Promise<SmartTurnResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(request)
    });

    const data = (await response.json().catch(() => null)) as Partial<SmartTurnResult> | null;

    if (!response.ok) {
      throw new Error(data?.reason || `Smart Turn endpoint failed with ${response.status}.`);
    }

    if (typeof data?.complete !== "boolean" || typeof data.probability !== "number") {
      throw new Error("Smart Turn endpoint returned an invalid response.");
    }

    return {
      complete: data.complete,
      probability: data.probability,
      source: "smart-turn-endpoint",
      reason: data.reason
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getSmartTurnWorker(pythonBinary: string, timeoutMs: number) {
  if (worker) {
    return worker;
  }

  worker = new SmartTurnWorker(pythonBinary, timeoutMs);
  return worker;
}

class SmartTurnWorker {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly lines: Interface;
  private readonly pending = new Map<string, PendingRequest>();
  private stderr = "";
  private nextId = 0;
  private closed = false;

  constructor(pythonBinary: string, startupTimeoutMs: number) {
    const scriptPath = join(process.cwd(), "scripts", "smart_turn_worker.py");
    this.process = spawn(pythonBinary, [scriptPath], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.lines = createInterface({ input: this.process.stdout });
    this.lines.on("line", (line) => this.handleLine(line));

    this.process.stderr.on("data", (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString()}`.slice(-4000);
    });

    this.process.once("error", (error) => {
      this.closeAll(error);
    });

    this.process.once("exit", (code, signal) => {
      this.closeAll(new Error(`Smart Turn worker exited (${code ?? signal ?? "unknown"}). ${this.stderr}`.trim()));
    });

    const startupTimer = setTimeout(() => {
      if (this.closed) {
        return;
      }
      this.process.kill();
      this.closeAll(new Error(`Smart Turn worker startup timed out after ${startupTimeoutMs}ms.`));
    }, startupTimeoutMs);

    this.process.once("spawn", () => clearTimeout(startupTimer));
  }

  analyze(request: SmartTurnRequest, timeoutMs: number): Promise<SmartTurnResult> {
    if (this.closed) {
      return Promise.reject(new Error("Smart Turn worker is closed."));
    }

    const id = String(++this.nextId);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Smart Turn analysis timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      try {
        this.process.stdin.write(`${JSON.stringify({ id, ...request })}\n`);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error("Unable to write to Smart Turn worker."));
      }
    });
  }

  private handleLine(line: string) {
    let response: WorkerResponse;

    try {
      response = JSON.parse(line) as WorkerResponse;
    } catch {
      return;
    }

    if (!response.id) {
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pending.delete(response.id);

    if (response.error) {
      pending.reject(new Error(response.error));
      return;
    }

    if (typeof response.complete !== "boolean" || typeof response.probability !== "number") {
      pending.reject(new Error("Smart Turn worker returned an invalid response."));
      return;
    }

    pending.resolve({
      complete: response.complete,
      probability: response.probability,
      source: "smart-turn-python"
    });
  }

  private closeAll(error: Error) {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.lines.close();
    worker = null;

    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}

function disabledTurnResult(reason: string): SmartTurnResult {
  return {
    complete: true,
    probability: 1,
    source: "disabled",
    reason
  };
}

function fallbackTurnResult(request: SmartTurnRequest, reason: string): SmartTurnResult {
  return {
    complete: request.durationMs >= 350,
    probability: request.durationMs >= 350 ? 1 : 0,
    source: "vad-fallback",
    reason
  };
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
