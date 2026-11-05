"use client";

import Link from "next/link";
import type { ShopContext } from "@/server/data/context";
import { CreateShop } from "./create-shop";
import { useLocale } from "@/components/layout/locale-provider";

export function ConnectionState({ kind }: { kind: Exclude<ShopContext["kind"], "ready" | "signed-out"> }) {
  const { t } = useLocale();
  if (kind === "no-shop") return (
    <section className="business-empty" aria-labelledby="no-shop-title">
      <p className="workspace-eyebrow">{t("FIRST STEP / YOUR SHOP")}</p>
      <h1 id="no-shop-title">{t("Make this workspace yours.")}</h1>
      <p>{t("Name your shop to start private inventory, khata and sales records.")}</p>
      <CreateShop />
    </section>
  );
  if (kind === "unavailable") return (
    <section className="business-empty" role="alert"><p className="workspace-eyebrow">{t("CONNECTION")}</p><h1>{t("Store data is unavailable.")}</h1><p>{t("Check the Supabase project and try again. Nothing was changed.")}</p></section>
  );
  return (
    <section className="business-empty" aria-labelledby="setup-title">
      <p className="workspace-eyebrow">{t("SUPABASE SETUP")}</p>
      <h1 id="setup-title">{t("Ready for a real store.")}</h1>
      <p>{t("Connect a Supabase project to enable sign-in and authoritative inventory, khata and sales data. The landing experience and mock AI preview remain available without credentials.")}</p>
      <Link className="button button-dark" href="/signin">{t("View sign-in setup")}</Link>
    </section>
  );
}
