import { getShopContext } from "@/server/data/context";
import { profileUpdateSchema } from "@/lib/auth/profile-schema";

export async function GET() {
  const context = await getShopContext();
  if (context.kind === "signed-out") return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (context.kind === "setup" || context.kind === "unavailable") return Response.json({ error: "Account details are unavailable. Try again." }, { status: 503 });
  const [{ data: account, error: authError }, { data: profile, error: profileError }, shopResult] = await Promise.all([
    context.client.auth.getUser(),
    context.client.from("profiles").select("display_name").eq("id", context.userId).maybeSingle(),
    context.kind === "ready" ? context.client.from("shops").select("id,name,phone,logo_path").eq("id", context.shop.id).eq("owner_id", context.userId).single() : Promise.resolve({ data: null, error: null }),
  ]);
  if (authError || !account.user || profileError || shopResult.error) return Response.json({ error: "Account details are unavailable. Try again." }, { status: 503 });
  const shop = shopResult.data;
  const signedLogo = shop?.logo_path
    ? await context.client.storage.from("shop-logos").createSignedUrl(shop.logo_path, 3600)
    : null;
  return Response.json({
    displayName: profile?.display_name || account.user.user_metadata?.display_name || "",
    email: account.user.email || "",
    shop: shop ? { id: shop.id, name: shop.name, currency: "INR", phone: shop.phone, logoUrl: signedLogo?.data?.signedUrl ?? null } : null,
  });
}

export async function PATCH(request: Request) {
  let raw: unknown;
  try { raw = await request.json(); } catch { return Response.json({ error: "Send a valid update." }, { status: 400 }); }
  const parsed = profileUpdateSchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "Check the name or phone number and try again." }, { status: 422 });
  const context = await getShopContext();
  if (context.kind === "signed-out") return Response.json({ error: "Sign in to continue." }, { status: 401 });
  if (context.kind === "setup" || context.kind === "unavailable") return Response.json({ error: "Account details are unavailable. Try again." }, { status: 503 });

  if (parsed.data.field === "displayName") {
    const { data, error } = await context.client.from("profiles").update({ display_name: parsed.data.value })
      .eq("id", context.userId).select("display_name").maybeSingle();
    if (error || !data) return Response.json({ error: "Your name could not be saved. Please try again." }, { status: 503 });
    return Response.json({ ok: true, value: data.display_name });
  }

  if (context.kind !== "ready") return Response.json({ error: "Create a shop before editing its details." }, { status: 409 });
  const field = parsed.data.field === "phone" ? "phone" : "name";
  const { data, error } = await context.client.from("shops").update({ [field]: parsed.data.value })
    .eq("id", context.shop.id).eq("owner_id", context.userId).select("name,phone").maybeSingle();
  if (error || !data) return Response.json({ error: field === "phone" ? "The shop phone could not be saved. Please try again." : "The shop name could not be saved. Check whether it is already in use." }, { status: 503 });
  return Response.json({ ok: true, value: field === "phone" ? data.phone : data.name });
}
