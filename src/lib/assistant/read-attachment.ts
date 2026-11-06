import { MAX_ATTACHMENT_SOURCE_BYTES, MAX_IMAGE_UPLOAD_BYTES } from "./attachment-limits";

export type PreparedAttachment = { extractedText: string; images: File[] };

export async function prepareShoppingAttachment(file: File): Promise<PreparedAttachment> {
  if (file.size === 0 || file.size > MAX_ATTACHMENT_SOURCE_BYTES) throw new Error("Choose a file under 5 MB.");
  if (["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) throw new Error("Choose an image under 4 MB.");
    return { extractedText: "", images: [file] };
  }
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Choose a JPG, PNG, WebP or PDF file.");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("The selected PDF is not valid.");

  // PDF.js is loaded only after a PDF is selected. No document is stored remotely.
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  const task = pdfjs.getDocument({ data: bytes });
  const pdf = await task.promise;
  try {
    if (pdf.numPages > 3) throw new Error("Use a PDF with at most three pages.");
    const texts: string[] = [];
    const images: File[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map((item) => "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "").join("").trim();
      if (text.length >= 3 && /[0-9०-९]/u.test(text)) {
        texts.push(text);
      } else {
        const original = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: Math.min(2, 1200 / original.width) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("This browser cannot render PDF pages.");
        await page.render({ canvas, canvasContext: context, viewport }).promise;
        const image = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PDF page could not be rendered.")), "image/jpeg", 0.85));
        images.push(new File([image], `page-${pageNumber}.jpg`, { type: "image/jpeg" }));
      }
      page.cleanup();
    }
    return { extractedText: texts.join("\n"), images };
  } finally {
    await task.destroy();
  }
}
