import { z } from "zod";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { streamSpeech } from "@/lib/speech/tts";
import { recordTtsUsage } from "@/lib/speech/usage";

export const runtime = "nodejs";

const requestSchema = z.object({
  text: z.string().min(1).max(4096),
  voice: z.string().optional()
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const result = await streamSpeech(body.text, body.voice);

    if (!result.audioStream || !result.format || !result.sampleRate) {
      return jsonOk({
        provider: result.provider,
        voice: result.voice,
        fallback: result.fallback
      });
    }

    recordUsageInBackground(result.provider, result.usageCharacters);

    return new Response(result.audioStream, {
      headers: {
        "Content-Type": "audio/pcm",
        "Cache-Control": "no-store",
        "X-TTS-Provider": result.provider,
        "X-TTS-Format": result.format,
        "X-TTS-Sample-Rate": String(result.sampleRate),
        "X-TTS-Voice": result.voice,
        ...(result.usageCharacters !== undefined ? { "X-TTS-Usage-Characters": String(result.usageCharacters) } : {})
      }
    });
  } catch (error) {
    return jsonError("Unable to stream speech.", 500, getErrorMessage(error));
  }
}

function recordUsageInBackground(provider: string, usageCharacters?: number) {
  if (provider !== "google" || usageCharacters === undefined) {
    return;
  }

  void recordTtsUsage("google", usageCharacters).catch(() => undefined);
}
