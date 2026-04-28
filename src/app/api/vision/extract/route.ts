import { z } from "zod";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { extractTextFromMaterial } from "@/lib/documents/extractText";
import { extractLearningContext, extractTextLearningContext } from "@/lib/vision/openaiVision";

export const runtime = "nodejs";

const requestSchema = z.object({
  imageDataUrl: z.string().min(32).optional(),
  materialDataUrl: z.string().min(32).optional(),
  mimeType: z.string().optional(),
  fileName: z.string().default("Uploaded material"),
  targetLanguage: z.string().default("zh-CN")
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const materialDataUrl = body.materialDataUrl || body.imageDataUrl;

    if (!materialDataUrl) {
      return jsonError("Unable to extract learning context.", 400, "No file payload was provided.");
    }

    const mimeType = body.mimeType || materialDataUrl.match(/^data:([^;,]+)/)?.[1] || "";
    const isImage = mimeType.startsWith("image/");

    const learningContext = isImage
      ? await extractLearningContext(materialDataUrl, body.targetLanguage)
      : await extractTextLearningContext({
          text: await extractTextFromMaterial(materialDataUrl, mimeType, body.fileName),
          targetLanguage: body.targetLanguage,
          fileName: body.fileName
        });

    return jsonOk({ learningContext });
  } catch (error) {
    return jsonError("Unable to extract learning context.", 500, getErrorMessage(error));
  }
}
