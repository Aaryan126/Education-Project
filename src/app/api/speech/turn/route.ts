import { z } from "zod";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { analyzeSmartTurn } from "@/lib/speech/smartTurn";

export const runtime = "nodejs";

const requestSchema = z.object({
  audioPcm16Base64: z.string().min(1),
  sampleRate: z.literal(16000),
  durationMs: z.number().positive()
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const result = await analyzeSmartTurn(body);
    return jsonOk(result);
  } catch (error) {
    return jsonError("Unable to analyze speech turn.", 500, getErrorMessage(error));
  }
}
