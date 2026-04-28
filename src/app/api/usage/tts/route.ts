import { jsonError, jsonOk } from "@/lib/api";
import { getCurrentTtsUsage } from "@/lib/speech/usage";

export const runtime = "nodejs";

export async function GET() {
  try {
    const usage = await getCurrentTtsUsage();

    return jsonOk(usage);
  } catch (error) {
    return jsonError("Unable to load TTS usage.", 500, error instanceof Error ? error.message : error);
  }
}
