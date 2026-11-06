import { getShopContext } from "@/server/data/context";
import { matchesShopLogoFormat, SHOP_LOGO_MAX_BYTES, validateShopLogoFile } from "@/lib/business/shop-logo";
import { reportShopLogoFailure } from "@/lib/business/shop-logo-diagnostics";

function stageFailure(stage: string, error: unknown, message: string, status = 503) {
  reportShopLogoFailure(stage, error);
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) return Response.json({ error: "Invalid upload origin." }, { status: 403 });
  const length = Number(request.headers.get("content-length") || "0");
  if (length > SHOP_LOGO_MAX_BYTES + 8192) return Response.json({ error: "Choose an image up to 2 MB." }, { status: 413 });
  let context;
  try { context = await getShopContext(); }
  catch (error) { return stageFailure("shop_context", error, "Your shop could not be loaded. Refresh the page and try again."); }
  if (context.kind === "signed-out") return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (context.kind !== "ready") return Response.json({ error: "Create a shop before uploading its image." }, { status: 409 });
  let data: FormData;
  try { data = await request.formData(); } catch { return Response.json({ error: "Choose an image file." }, { status: 400 }); }
  const file = data.get("image");
  if (!(file instanceof File)) return Response.json({ error: "Choose a JPEG, PNG or WebP image up to 2 MB." }, { status: 422 });
  const fileError = validateShopLogoFile(file);
  if (fileError) return Response.json({ error: fileError }, { status: 422 });
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await file.arrayBuffer()); }
  catch (error) { return stageFailure("image_read", error, "The selected image could not be read. Choose it again and retry.", 400); }
  if (!matchesShopLogoFormat(bytes, file.type)) return Response.json({ error: "The image format does not match its file type." }, { status: 422 });
  const path = `${context.shop.id}/logo`;
  try {
    const { data: shop, error: readError } = await context.client.from("shops").select("logo_path")
      .eq("id", context.shop.id).eq("owner_id", context.userId).single();
    if (readError || !shop) return stageFailure("shop_read", readError, "Shop details could not be loaded. Refresh the page and try again.");

    const bucket = context.client.storage.from("shop-logos");
    const uploaded = await bucket.upload(path, bytes, { contentType: file.type, upsert: true, cacheControl: "3600" });
    if (uploaded.error) {
      const storageStatus = Number(uploaded.error.statusCode);
      const forbidden = storageStatus === 401 || storageStatus === 403;
      return stageFailure("storage_upload", uploaded.error,
        forbidden ? "Secure image storage denied this upload. Refresh your sign-in and try again." : "Secure image storage is temporarily unavailable. Check your connection and retry.",
        forbidden ? 403 : 503);
    }

    const { data: saved, error: saveError } = await context.client.from("shops").update({ logo_path: path })
      .eq("id", context.shop.id).eq("owner_id", context.userId).select("id").maybeSingle();
    if (saveError || !saved) return stageFailure("shop_persist", saveError, "The image uploaded, but its shop link could not be saved. Retry the upload.");

    const signed = await bucket.createSignedUrl(path, 3600);
    if (signed.error || !signed.data?.signedUrl) {
      return stageFailure("private_preview", signed.error, "The image was saved privately, but its preview could not be loaded. Refresh the profile.");
    }
    return Response.json({ ok: true, logoUrl: signed.data.signedUrl }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return stageFailure("storage_or_persistence", error, "The image could not be saved. Check your connection and try again.");
  }
}
