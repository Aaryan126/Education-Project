const MAX_RENDERED_PDF_PAGES = 4;
const MAX_RENDERED_PAGE_WIDTH = 1400;
const PAGE_IMAGE_QUALITY = 0.82;

type PdfJsModule = typeof import("pdfjs-dist");

let pdfWorkerConfigured = false;

export async function renderPdfPageImages(dataUrl: string) {
  const pdfjs = await import("pdfjs-dist");
  configurePdfWorker(pdfjs);

  const pdf = await pdfjs.getDocument({
    data: dataUrlToUint8Array(dataUrl)
  }).promise;

  const pageCount = Math.min(pdf.numPages, MAX_RENDERED_PDF_PAGES);
  const images: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.min(2, MAX_RENDERED_PAGE_WIDTH / baseViewport.width);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Canvas rendering is not available in this browser.");
      }

      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);

      await page.render({
        canvas,
        canvasContext: context,
        viewport
      }).promise;

      images.push(canvas.toDataURL("image/jpeg", PAGE_IMAGE_QUALITY));
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }

  return images;
}

function configurePdfWorker(pdfjs: PdfJsModule) {
  if (pdfWorkerConfigured) {
    return;
  }

  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.mjs", import.meta.url).toString();
  pdfWorkerConfigured = true;
}

function dataUrlToUint8Array(dataUrl: string) {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
