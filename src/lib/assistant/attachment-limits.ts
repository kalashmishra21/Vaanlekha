export const MAX_ATTACHMENT_SOURCE_BYTES = 5_000_000;
export const MAX_IMAGE_UPLOAD_BYTES = 4_000_000;
export const MAX_IMAGE_COUNT = 3;

export function isImageUploadWithinLimit(files: readonly { size: number }[]): boolean {
  if (files.length > MAX_IMAGE_COUNT) return false;
  if (files.some((file) => !Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_IMAGE_UPLOAD_BYTES)) return false;
  return files.reduce((total, file) => total + file.size, 0) <= MAX_IMAGE_UPLOAD_BYTES;
}
