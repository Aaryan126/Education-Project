import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import mammoth from "mammoth";

export type ParsedMaterialData = {
  mimeType: string;
  buffer: Buffer;
};

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
    const workerPath = resolvePdfWorkerPath();
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

function resolvePdfWorkerPath() {
  const candidates = [
    join(process.cwd(), "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"),
    join(process.cwd(), "node_modules/pdf-parse/dist/worker/pdf.worker.mjs")
  ];
  const workerPath = candidates.find((candidate) => existsSync(candidate));

  if (!workerPath) {
    throw new Error("PDF worker file was not found. Run npm install and restart the dev server.");
  }

  return workerPath;
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
