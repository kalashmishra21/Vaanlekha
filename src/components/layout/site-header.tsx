import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { BrandLockup } from "./brand";
import { LandingThemeToggle } from "./landing-theme-toggle";
import styles from "./site-header.module.css";

export function SiteHeader() {
  return (
    <header className={styles.header}>
      <div className={styles.content}>
        <BrandLockup />
        <div className={styles.cluster}>
          <nav className={styles.nav} aria-label="Landing navigation">
            <a href="#story">How it works</a>
            <a href="#voice-demo">Voice demo</a>
          </nav>
          <div className={styles.actions}><LandingThemeToggle /><Link className={styles.cta} href="/signin">Explore the Studio <ArrowUpRight size={16} strokeWidth={1.8} aria-hidden="true" /></Link></div>
        </div>
      </div>
    </header>
  );
}
