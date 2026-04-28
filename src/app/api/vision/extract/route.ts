import { z } from "zod";
import { getErrorMessage, jsonError, jsonOk } from "@/lib/api";
import { extractTextFromMaterial } from "@/lib/documents/extractText";
import { extractLearningContext, extractTextLearningContext } from "@/lib/vision/openaiVision";

export const runtime = "nodejs";
const MAX_MATERIAL_DATA_URL_LENGTH = 25 * 1024 * 1024;

const requestSchema = z.object({
  imageDataUrl: z.string().min(32).optional(),
  materialDataUrl: z.string().min(32).optional(),
  pdfPageImageDataUrls: z.array(z.string().min(32)).max(4).optional(),
  mimeType: z.string().optional(),
  fileName: z.string().default("Uploaded material"),
  targetLanguage: z.string().default("zh-CN")
});

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();

    if (rawBody.length > MAX_MATERIAL_DATA_URL_LENGTH) {
      return jsonError(
        "Unable to extract learning context.",
        413,
        "File upload and rendered page images are too large. Use a smaller PDF or fewer image-heavy pages."
      );
    }

    const body = requestSchema.parse(JSON.parse(rawBody));
    const materialDataUrl = body.materialDataUrl || body.imageDataUrl;

    if (!materialDataUrl) {
      return jsonError("Unable to extract learning context.", 400, "No file payload was provided.");
    }

    const mimeType = body.mimeType || materialDataUrl.match(/^data:([^;,]+)/)?.[1] || "";
    const isImage = mimeType.startsWith("image/");

    const pdfPageImageDataUrls = body.pdfPageImageDataUrls ?? [];
    const extractedText = isImage ? "" : await extractTextFromMaterialOrEmpty(materialDataUrl, mimeType, body.fileName, pdfPageImageDataUrls.length > 0);
    const learningContext = isImage
      ? await extractLearningContext(materialDataUrl, body.targetLanguage)
      : await extractTextLearningContext({
          text: extractedText,
          targetLanguage: body.targetLanguage,
          fileName: body.fileName,
          pageImageDataUrls: pdfPageImageDataUrls
        });

    return jsonOk({ learningContext });
  } catch (error) {
    const message = getErrorMessage(error);
    const lowerMessage = message.toLowerCase();
    const isUserActionable =
      error instanceof SyntaxError ||
      lowerMessage.includes("no readable text") ||
      lowerMessage.includes("unsupported document") ||
      lowerMessage.includes("base64 data url") ||
      lowerMessage.includes("file payload");

    return jsonError("Unable to extract learning context.", isUserActionable ? 400 : 500, message);
  }
}

async function extractTextFromMaterialOrEmpty(
  dataUrl: string,
  mimeType: string,
  fileName: string,
  allowEmptyFallback: boolean
) {
  try {
    return await extractTextFromMaterial(dataUrl, mimeType, fileName);
  } catch (error) {
    if (allowEmptyFallback) {
      return "";
    }

    throw error;
  }
}
