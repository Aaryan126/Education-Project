import { NextResponse } from "next/server";

export type ApiErrorBody = {
  error: string;
  details?: unknown;
};

export function jsonOk<T>(body: T, init?: ResponseInit) {
  return NextResponse.json(body, init);
}

export function jsonError(error: string, status = 500, details?: unknown) {
  const body: ApiErrorBody = details === undefined ? { error } : { error, details };
  return NextResponse.json(body, { status });
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unexpected error";
}

export function decodeDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);

  if (!match) {
    throw new Error("Expected a base64 data URL.");
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64")
  };
}
