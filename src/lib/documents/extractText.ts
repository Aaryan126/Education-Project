import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import mammoth from "mammoth";

export type ParsedMaterialData = {
  mimeType: string;
  buffer: Buffer;
};

const requireFromHere = createRequire(import.meta.url);
let pdfWorkerConfigured = false;
let pdfWorkerDataUrl: string | null = null;

export function parseDataUrl(dataUrl: string): ParsedMaterialData {
  const match = /^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/s.exec(dataUrl);

  if (!match) {
    throw new Error("File payload must be a base64 data URL.");
  }

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64")
  };
}

async function extractPdfText(buffer: Buffer) {
  const { PDFParse } = await import("pdf-parse");

  if (!pdfWorkerConfigured) {
    const workerPath = requireFromHere.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
    pdfWorkerDataUrl ??= `data:text/javascript;base64,${readFileSync(workerPath).toString("base64")}`;
    PDFParse.setWorker(pdfWorkerDataUrl);
    pdfWorkerConfigured = true;
  }

  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.text.trim();
  } finally {
    await parser.destroy();
  }
}

export async function extractTextFromMaterial(dataUrl: string, mimeType: string, fileName: string) {
  const parsed = parseDataUrl(dataUrl);
  const resolvedMimeType = mimeType || parsed.mimeType;

  if (resolvedMimeType === "application/pdf" || /\.pdf$/i.test(fileName)) {
    return extractPdfText(parsed.buffer);
  }

  if (
    resolvedMimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    /\.docx$/i.test(fileName)
  ) {
    const result = await mammoth.extractRawText({ buffer: parsed.buffer });
    return result.value.trim();
  }

  throw new Error("Unsupported document type. Upload an image, PDF, or Word .docx file.");
}
