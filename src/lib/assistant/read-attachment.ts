import { MAX_ATTACHMENT_SOURCE_BYTES, MAX_IMAGE_UPLOAD_BYTES } from "./attachment-limits";

export type PreparedAttachment = { images: File[]; pdf?: File };

const supportedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function imageTypeFromName(file: File): string | null {
  const extension = file.name.toLocaleLowerCase("en-US").split(".").at(-1);
  return extension === "jpg" || extension === "jpeg" ? "image/jpeg"
    : extension === "png" ? "image/png" : extension === "webp" ? "image/webp" : null;
}

async function convertMobileImageToJpeg(file: File): Promise<File> {
  let bitmap: ImageBitmap | null = null;
  let objectUrl: string | null = null;
  try {
    try { bitmap = await createImageBitmap(file); }
    catch {
      objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Image conversion is unavailable in this browser.");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return await jpegFromCanvas(canvas, file.name);
    }
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Image conversion is unavailable in this browser.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await jpegFromCanvas(canvas, file.name);
  } catch (error) {
    if (error instanceof Error && /larger than 4 MB|unavailable in this browser/u.test(error.message)) throw error;
    throw new Error("This mobile photo format could not be converted here. Save it as JPG, PNG or WebP and try again.");
  } finally {
    bitmap?.close();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

async function jpegFromCanvas(canvas: HTMLCanvasElement, originalName: string): Promise<File> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Image conversion failed.")), "image/jpeg", 0.86));
  if (blob.size > MAX_IMAGE_UPLOAD_BYTES) throw new Error("The converted image is larger than 4 MB. Choose a smaller image.");
  const name = originalName.replace(/\.[^.]+$/u, "") || "shop-list";
  return new File([blob], `${name}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}

export async function prepareShoppingAttachment(file: File): Promise<PreparedAttachment> {
  if (file.size === 0 || file.size > MAX_ATTACHMENT_SOURCE_BYTES) throw new Error("Choose a file under 5 MB.");
  const normalizedType = file.type || imageTypeFromName(file) || "";
  if (supportedImageTypes.has(normalizedType)) {
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) throw new Error("Choose an image under 4 MB.");
    return { images: [file.type === normalizedType ? file : new File([file], file.name, { type: normalizedType, lastModified: file.lastModified })] };
  }
  if (["image/heic", "image/heif"].includes(normalizedType) || /\.(?:heic|heif)$/iu.test(file.name)) {
    const converted = await convertMobileImageToJpeg(file);
    return { images: [converted] };
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
