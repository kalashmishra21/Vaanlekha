import { MAX_ATTACHMENT_SOURCE_BYTES, MAX_IMAGE_UPLOAD_BYTES } from "./attachment-limits";

export type PreparedAttachment = { images: File[]; pdf?: File };

export async function prepareShoppingAttachment(file: File): Promise<PreparedAttachment> {
  if (file.size === 0 || file.size > MAX_ATTACHMENT_SOURCE_BYTES) throw new Error("Choose a file under 5 MB.");
  if (["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) throw new Error("Choose an image under 4 MB.");
    return { images: [file] };
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Choose a JPG, PNG, WebP or PDF file.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("The selected PDF is not valid.");

  // Gemini receives the original PDF. PDF.js renders up to three small fallback
  // previews only; it does not replace Gemini's native document understanding.
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: bytes });
  const pdf = await task.promise;
  try {
    if (pdf.numPages > 3) throw new Error("Use a PDF with at most three pages.");
    const images: File[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      if (pageNumber <= 3) {
        try {
          const original = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: Math.min(1.5, 1200 / original.width) });
          const canvas = document.createElement("canvas");
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d");
          if (context) {
            await page.render({ canvas, canvasContext: context, viewport }).promise;
            const image = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PDF preview unavailable")), "image/jpeg", 0.75));
            images.push(new File([image], `page-${pageNumber}.jpg`, { type: "image/jpeg" }));
          }
        } catch {
          // Native PDF analysis remains available if this browser cannot rasterize a fallback page.
        }
      }
      page.cleanup();
    }
    return { images, pdf: file };
  } finally {
    await task.destroy();
  }
}
