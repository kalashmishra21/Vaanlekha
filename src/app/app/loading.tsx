"use client";

import { useLocale } from "@/components/layout/locale-provider";

export default function WorkspacePageLoading() {
  const { t } = useLocale();
  return <div className="workspace-page-loading" role="status" aria-live="polite">
    <span className="workspace-loading-line" />
    <strong>{t("Loading your store view…")}</strong>
    <p>{t("Your latest records are on their way.")}</p>
  </div>;
}
