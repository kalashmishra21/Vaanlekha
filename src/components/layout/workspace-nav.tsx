"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartNoAxesCombined, House, MessageCircleMore, Package, ReceiptText, ScrollText, Truck } from "lucide-react";
import { useLocale } from "./locale-provider";

const groups = [
  { label: "Work", items: [
    { href: "/app/assistant", label: "Assistant", icon: MessageCircleMore },
    { href: "/app", label: "Overview", icon: House },
  ] },
  { label: "Your store", items: [
    { href: "/app/inventory", label: "Inventory", icon: Package },
    { href: "/app/khata", label: "Khata", icon: ScrollText },
    { href: "/app/sales", label: "Sales", icon: ChartNoAxesCombined },
  ] },
  { label: "Supply", items: [
    { href: "/app/suppliers", label: "Suppliers", icon: Truck },
    { href: "/app/orders", label: "Orders", icon: ReceiptText },
  ] },
];

export function WorkspaceNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useLocale();
  return (
    <nav className="workspace-nav" aria-label={t("Workspace navigation")}>
      {groups.map((group) => <div className="workspace-nav-group" key={group.label}>
        <span className="workspace-nav-label">{t(group.label)}</span>
        {group.items.map(({ href, label, icon: Icon }) => <Link key={href} href={href} prefetch={true} onClick={onNavigate}
          title={t(label)} aria-label={t(label)} aria-current={pathname === href ? "page" : undefined}>
          <Icon size={19} strokeWidth={1.65} aria-hidden="true" /><span>{t(label)}</span>
        </Link>)}
      </div>)}
    </nav>
  );
}
