export const SHOP_LOGO_MAX_BYTES = 2 * 1024 * 1024;

const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export function validateShopLogoFile(file: { type: string; size: number }): string | null {
  if (!allowedImageTypes.has(file.type) || file.size < 12 || file.size > SHOP_LOGO_MAX_BYTES) {
    return "Choose a JPEG, PNG or WebP image up to 2 MB.";
  }
  return null;
}

export function matchesShopLogoFormat(bytes: Uint8Array, type: string): boolean {
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (type === "image/webp") return String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return false;
}
