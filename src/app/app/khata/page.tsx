import { ConnectionState } from "@/components/business/connection-state";
import { KhataWorkspace } from "@/components/business/khata-workspace";
import { getShopContext } from "@/server/data/context";
import { getKhata } from "@/server/data/queries";

export default async function KhataPage() {
  const context = await getShopContext();
  if (context.kind !== "ready") return <ConnectionState kind={context.kind === "signed-out" ? "unavailable" : context.kind} />;
  let data: Awaited<ReturnType<typeof getKhata>> | null = null;
  try { data = await getKhata(context); } catch { /* Render the unavailable state. */ }
  return data ? <KhataWorkspace {...data} shopName={context.shop.name} /> : <ConnectionState kind="unavailable" />;
}
