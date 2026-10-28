import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { z } from "zod";
import { PrintReceiptButton } from "@/components/business/print-receipt-button";
import { rupees } from "@/lib/business/calculations";
import { saleSchema } from "@/lib/business/schemas";
import { whatsAppDraft } from "@/lib/business/sharing";
import { getShopContext } from "@/server/data/context";
import styles from "./receipt.module.css";

export const metadata: Metadata = { title: "Sale receipt | Vaanlekha", robots: { index: false, follow: false } };

const receiptItemSchema = z.object({
  product_id: z.string().uuid(), quantity: z.coerce.number(),
  unit_price: z.coerce.number(), line_total: z.coerce.number(),
});

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const context = await getShopContext();
  if (context.kind === "signed-out") redirect("/signin");
  if (context.kind !== "ready") redirect("/app");

  const [saleResult, itemResult] = await Promise.all([
    context.client.from("sales").select("id,total_amount,payment_method,created_at").eq("id", id).eq("shop_id", context.shop.id).maybeSingle(),
    context.client.from("sale_items").select("product_id,quantity,unit_price,line_total").eq("sale_id", id).eq("shop_id", context.shop.id),
  ]);
  if (saleResult.error || itemResult.error) throw new Error("Receipt data is temporarily unavailable.");
  if (!saleResult.data) notFound();
  const sale = saleSchema.parse(saleResult.data);
  const items = z.array(receiptItemSchema).parse(itemResult.data ?? []);
  const productIds = [...new Set(items.map((item) => item.product_id))];
  const productResult = productIds.length
    ? await context.client.from("products").select("id,name,unit").eq("shop_id", context.shop.id).in("id", productIds)
    : { data: [], error: null };
  if (productResult.error) throw new Error("Receipt products are temporarily unavailable.");
  const products = new Map(z.array(z.object({ id: z.string().uuid(), name: z.string(), unit: z.string() })).parse(productResult.data ?? []).map((product) => [product.id, product]));
  const message = `Receipt ${sale.id.slice(0, 8)} from ${context.shop.name}\n${items.map((item) => `${products.get(item.product_id)?.name ?? "Product"}: ${item.quantity} ${products.get(item.product_id)?.unit ?? "units"} × ${rupees(item.unit_price)} = ${rupees(item.line_total)}`).join("\n")}\nTotal: ${rupees(sale.total_amount)}\nPayment: ${sale.payment_method?.toUpperCase() ?? "not recorded"}`;
  const shareLink = whatsAppDraft(message);

  return <main className={styles.page}>
    <div className={styles.toolbar}><Link href="/app/sales">← Back to sales</Link><div><PrintReceiptButton />{shareLink && <a href={shareLink} target="_blank" rel="noopener noreferrer">Open WhatsApp draft <ExternalLink size={16} aria-hidden="true" /></a>}</div></div>
    <article className={styles.sheet} aria-labelledby="receipt-title">
      <div className={styles.masthead}><span>STORE RECORD / SALE</span><span>{new Date(sale.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })}</span></div>
      <h1 id="receipt-title">Sale <em>receipt.</em></h1>
      <div className={styles.identity}><strong>{context.shop.name}</strong><span>Receipt ID: {sale.id}</span></div>
      <table className={styles.table}><thead><tr><th scope="col">Product</th><th scope="col">Quantity</th><th scope="col">Unit price</th><th scope="col">Amount</th></tr></thead><tbody>{items.map((item, index) => <tr key={`${item.product_id}-${index}`}><td>{products.get(item.product_id)?.name ?? "Product"}</td><td>{item.quantity} {products.get(item.product_id)?.unit ?? "units"}</td><td>{rupees(item.unit_price)}</td><td>{rupees(item.line_total)}</td></tr>)}</tbody></table>
      <div className={styles.total}><div><span>Payment method</span><strong>{sale.payment_method?.toUpperCase() ?? "Not recorded"}</strong></div><div><span>Sale total</span><strong>{rupees(sale.total_amount)}</strong></div></div>
      <p className={styles.footnote}>This receipt reflects the saved store transaction. Product names reflect current records. This is not a GST tax invoice.</p>
    </article>
  </main>;
}
