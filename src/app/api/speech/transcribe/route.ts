import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { transcribeAudio } from "@/lib/speech/openaiStt";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audio = formData.get("audio");
    const language = formData.get("language");

    if (!(audio instanceof File)) {
      return jsonError("Missing audio file.", 400);
    }

    const result = await transcribeAudio(audio, typeof language === "string" ? language : undefined);
    return jsonOk(result);
  } catch (error) {
    return jsonError("Unable to transcribe audio.", 500, getErrorMessage(error));
  }
}
