"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { BrandLockup } from "./brand";
import { LandingThemeToggle } from "./landing-theme-toggle";
import { LanguageControl } from "./language-control";
import styles from "./site-header.module.css";
import { useLocale } from "./locale-provider";

export function SiteHeader() {
  const { t } = useLocale();
  return (
    <header className={styles.header}>
      <div className={styles.content}>
        <BrandLockup />
        <div className={styles.cluster}>
          <nav className={styles.nav} aria-label="Landing navigation">
            <a href="#story">{t("How it works")}</a>
            <a href="#voice-demo">{t("Voice demo")}</a>
          </nav>
          <div className={styles.actions}><LanguageControl compact persistProfile={false} /><LandingThemeToggle /><Link className={styles.cta} href="/signin">{t("Explore the Studio")} <ArrowUpRight size={16} strokeWidth={1.8} aria-hidden="true" /></Link></div>
        </div>
      </div>
    </header>
  );
}
