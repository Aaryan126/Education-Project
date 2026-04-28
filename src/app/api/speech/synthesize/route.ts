import { z } from "zod";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { synthesizeSpeech } from "@/lib/speech/tts";
import { recordTtsUsage } from "@/lib/speech/usage";

export const runtime = "nodejs";

const requestSchema = z.object({
  text: z.string().min(1).max(4096),
  voice: z.string().optional()
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const result = await synthesizeSpeech(body.text, body.voice);
    recordUsageInBackground(result.provider, result.usageCharacters);

    if (result.audioBuffer && result.format && request.headers.get("accept")?.includes("audio/mpeg")) {
      return new Response(new Uint8Array(result.audioBuffer), {
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "no-store",
          "X-TTS-Provider": result.provider,
          "X-TTS-Format": result.format,
          "X-TTS-Voice": result.voice,
          ...(result.usageCharacters !== undefined
            ? { "X-TTS-Usage-Characters": String(result.usageCharacters) }
            : {})
        }
      });
    }

    const responseResult = {
      audioBase64: result.audioBuffer ? result.audioBuffer.toString("base64") : null,
      format: result.format,
      provider: result.provider,
      voice: result.voice,
      fallback: result.fallback
    };

    return jsonOk(responseResult);
  } catch (error) {
    return jsonError("Unable to synthesize speech.", 500, getErrorMessage(error));
  }
}

function recordUsageInBackground(provider: string, usageCharacters?: number) {
  if (provider !== "google" || usageCharacters === undefined) {
    return;
  }

  void recordTtsUsage("google", usageCharacters).catch(() => undefined);
}
