import Link from "next/link";
import { ArrowUpRight, AudioLines, PackagePlus } from "lucide-react";
import { ConnectionState } from "@/components/business/connection-state";
import { rupees } from "@/lib/business/calculations";
import { getShopContext } from "@/server/data/context";
import { getOverview } from "@/server/data/queries";

export default async function Overview() {
  const context = await getShopContext();
  if (context.kind !== "ready") return <ConnectionState kind={context.kind === "signed-out" ? "unavailable" : context.kind} />;
  let data: Awaited<ReturnType<typeof getOverview>> | null = null;
  try { data = await getOverview(context); } catch { /* Keep database errors out of the UI. */ }
  if (!data) return <ConnectionState kind="unavailable" />;

  const activity = [
    ...data.recentMovements.map((movement) => ({ id: movement.id, at: movement.created_at,
      kind: "Stock", label: `${data.products.find((product) => product.id === movement.product_id)?.name ?? "Product"} ${movement.quantity_delta > 0 ? "+" : ""}${movement.quantity_delta}`, href: "/app/inventory" })),
    ...data.recentSales.map((sale) => ({ id: sale.id, at: sale.created_at, kind: "Sale", label: `${rupees(sale.total_amount)} · ${sale.payment_method?.toUpperCase() ?? "payment unset"}`, href: "/app/sales" })),
    ...data.recentEntries.map((entry) => ({ id: entry.id, at: entry.created_at, kind: "Khata", label: `${data.customers.find((customer) => customer.id === entry.customer_id)?.name ?? "Customer"} · ${entry.type === "received" ? "received" : "gave"} ${rupees(entry.amount)}`, href: "/app/khata" })),
    ...data.recentOrders.map((order) => ({ id: order.id, at: order.updated_at, kind: "Order", label: `Purchase order ${order.status}`, href: "/app/orders" })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);

  return <div className="overview-page business-page">
    <div className="overview-heading"><div className="workspace-page-heading"><p className="workspace-eyebrow">OVERVIEW / {context.shop.name.toUpperCase()}</p><h1>Store <em>pulse.</em></h1><p>Today’s figures and recent actions, directly from your shop.</p></div><Link href="/app/assistant" className="overview-ask"><AudioLines size={21} strokeWidth={1.5} aria-hidden="true" /><span><strong>Ask Vaani</strong><small>Speak or type a store request</small></span><ArrowUpRight size={20} aria-hidden="true" /></Link></div>
    <div className="metric-grid">
      <Link href="/app/sales" className="metric"><span>TODAY’S SALES</span><strong>{rupees(data.todaySales)}</strong><small>{data.saleCount} recorded sale{data.saleCount === 1 ? "" : "s"}</small></Link>
      <Link href="/app/orders" className="metric"><span>NEEDS REORDER</span><strong>{data.lowStock.length}</strong><small>Products at or below threshold</small></Link>
      <Link href="/app/khata" className="metric"><span>KHATA OUTSTANDING</span><strong>{rupees(data.outstanding)}</strong><small>Customers owe the shop</small></Link>
    </div>
    <div className="overview-work-grid">
      <section className="overview-work-panel"><div className="section-heading"><span>REORDER WATCH</span><Link href="/app/orders">Plan an order <ArrowUpRight size={15} aria-hidden="true" /></Link></div>
        {data.lowStock.length ? <ul className="overview-stock-list">{data.lowStock.slice(0, 5).map((product) => <li key={product.id}><span><strong>{product.name}</strong><small>Threshold {product.low_stock_threshold} {product.unit}</small></span><b>{product.current_stock} left</b></li>)}</ul> : <div className="overview-empty"><PackagePlus size={24} aria-hidden="true" /><p>Shelves are above their reorder thresholds.</p></div>}
      </section>
      <section className="overview-work-panel"><div className="section-heading"><span>RECENT ACTIVITY</span><span>REAL STORE EVENTS</span></div>
        {activity.length ? <ol className="overview-activity">{activity.map((event) => <li key={`${event.kind}-${event.id}`}><Link href={event.href}><span className="overview-activity-kind">{event.kind}</span><strong>{event.label}</strong><time dateTime={event.at}>{new Date(event.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</time></Link></li>)}</ol> : <p className="business-muted">No recent store activity. Your first stock movement, sale, ledger entry or order will appear here.</p>}
      </section>
    </div>
  </div>;
}
