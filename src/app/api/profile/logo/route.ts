import { getShopContext } from "@/server/data/context";

const maxBytes = 2 * 1024 * 1024;
const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);

function matchesImage(bytes: Uint8Array, type: string) {
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (type === "image/webp") return String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return false;
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return Response.json({ error: "Invalid upload origin." }, { status: 403 });
  const length = Number(request.headers.get("content-length") || "0");
  if (length > maxBytes + 8192) return Response.json({ error: "Choose an image under 2 MB." }, { status: 413 });
  const context = await getShopContext();
  if (context.kind === "signed-out") return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (context.kind !== "ready") return Response.json({ error: "Create a shop before uploading its image." }, { status: 409 });
  let data: FormData;
  try { data = await request.formData(); } catch { return Response.json({ error: "Choose an image file." }, { status: 400 }); }
  const file = data.get("image");
  if (!(file instanceof File) || !allowed.has(file.type) || file.size < 12 || file.size > maxBytes) {
    return Response.json({ error: "Choose a JPEG, PNG or WebP image under 2 MB." }, { status: 422 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!matchesImage(bytes, file.type)) return Response.json({ error: "The image format does not match its file type." }, { status: 422 });
  const path = `${context.shop.id}/logo`;
  const { data: shop, error: readError } = await context.client.from("shops").select("logo_path")
    .eq("id", context.shop.id).eq("owner_id", context.userId).single();
  if (readError || !shop) return Response.json({ error: "Shop details are unavailable. Please try again." }, { status: 503 });
  const bucket = context.client.storage.from("shop-logos");
  const uploaded = shop.logo_path === path
    ? await bucket.update(path, bytes, { contentType: file.type, cacheControl: "3600" })
    : await bucket.upload(path, bytes, { contentType: file.type, upsert: false, cacheControl: "3600" });
  const uploadError = uploaded.error;
  if (uploadError) {
    console.warn("Shop image upload failed", { statusCode: uploadError.statusCode, reason: uploadError.message });
    return Response.json({ error: "The image could not be uploaded. Please try again." }, { status: 503 });
  }
  const { data: saved, error: saveError } = await context.client.from("shops").update({ logo_path: path })
    .eq("id", context.shop.id).eq("owner_id", context.userId).select("id").maybeSingle();
  if (saveError || !saved) return Response.json({ error: "The image uploaded, but the shop could not be updated. Please retry." }, { status: 503 });
  const signed = await context.client.storage.from("shop-logos").createSignedUrl(path, 3600);
  return Response.json({ ok: true, logoUrl: signed.data?.signedUrl ?? null }, { headers: { "Cache-Control": "private, no-store" } });
}
