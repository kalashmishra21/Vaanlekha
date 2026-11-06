import { getShopContext } from "@/server/data/context";
import { matchesShopLogoFormat, SHOP_LOGO_MAX_BYTES, validateShopLogoFile } from "@/lib/business/shop-logo";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return Response.json({ error: "Invalid upload origin." }, { status: 403 });
  const length = Number(request.headers.get("content-length") || "0");
  if (length > SHOP_LOGO_MAX_BYTES + 8192) return Response.json({ error: "Choose an image up to 2 MB." }, { status: 413 });
  const context = await getShopContext();
  if (context.kind === "signed-out") return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (context.kind !== "ready") return Response.json({ error: "Create a shop before uploading its image." }, { status: 409 });
  let data: FormData;
  try { data = await request.formData(); } catch { return Response.json({ error: "Choose an image file." }, { status: 400 }); }
  const file = data.get("image");
  if (!(file instanceof File)) return Response.json({ error: "Choose a JPEG, PNG or WebP image up to 2 MB." }, { status: 422 });
  const fileError = validateShopLogoFile(file);
  if (fileError) return Response.json({ error: fileError }, { status: 422 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!matchesShopLogoFormat(bytes, file.type)) return Response.json({ error: "The image format does not match its file type." }, { status: 422 });
  const path = `${context.shop.id}/logo`;
  const { data: shop, error: readError } = await context.client.from("shops").select("logo_path")
    .eq("id", context.shop.id).eq("owner_id", context.userId).single();
  if (readError || !shop) return Response.json({ error: "Shop details are unavailable. Please try again." }, { status: 503 });
  const bucket = context.client.storage.from("shop-logos");
  const uploaded = await bucket.upload(path, bytes, { contentType: file.type, upsert: true, cacheControl: "3600" });
  const uploadError = uploaded.error;
  if (uploadError) {
    console.warn("Shop image upload failed", { statusCode: uploadError.statusCode });
    return Response.json({ error: "The image could not be uploaded. Please try again." }, { status: 503 });
  }
  const { data: saved, error: saveError } = await context.client.from("shops").update({ logo_path: path })
    .eq("id", context.shop.id).eq("owner_id", context.userId).select("id").maybeSingle();
  if (saveError || !saved) return Response.json({ error: "The image uploaded, but the shop could not be updated. Please retry." }, { status: 503 });
  const signed = await context.client.storage.from("shop-logos").createSignedUrl(path, 3600);
  if (signed.error || !signed.data?.signedUrl) {
    return Response.json({ error: "The image was saved, but its private preview could not be loaded. Please retry." }, { status: 503 });
  }
  return Response.json({ ok: true, logoUrl: signed.data.signedUrl }, { headers: { "Cache-Control": "private, no-store" } });
}
