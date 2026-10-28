import { z } from "zod";
import { getShopContext } from "@/server/data/context";
import { enforceShopRateLimit } from "@/server/security/rate-limit";
import { hashReviewToken, newReviewToken } from "@/lib/reviews/tokens";

const schema = z.object({ saleId: z.uuid() }).strict();

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Invalid request origin." }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 4096) return Response.json({ error: "Invalid request." }, { status: 413 });
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid request." }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Choose a recorded sale." }, { status: 422 });
  const context = await getShopContext();
  if (context.kind === "signed-out") return Response.json({ error: "Sign in to request a review." }, { status: 401 });
  if (context.kind !== "ready") return Response.json({ error: "Store unavailable." }, { status: 503 });
  const limit = await enforceShopRateLimit(context, "business_action");
  if (limit) return limit;
  const token = newReviewToken();
  const { error } = await context.client.rpc("issue_review_invite", {
    p_shop_id: context.shop.id, p_sale_id: parsed.data.saleId, p_token_hash: hashReviewToken(token),
  });
  if (error) return Response.json({ error: error.code === "23505" ? "This sale already has a review." : "Review link unavailable for this sale." }, { status: 409 });
  return Response.json({ path: `/review/${token}` }, { headers: { "Cache-Control": "no-store" } });
}
