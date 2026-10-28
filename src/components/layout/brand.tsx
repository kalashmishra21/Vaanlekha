import Link from "next/link";

export function BrandMark({ size = 34 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" className="saathi-brand-symbol">
    <path d="M24 4 42 14v20L24 44 6 34V14L24 4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <path d="m13 15 11 21 11-21" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M19 15h10M21 20h6M23 25h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity=".82" />
  </svg>;
}

export function BrandLockup({ href = "/", className = "brand" }: { href?: string; className?: string }) {
  return <Link href={href} className={`${className} saathi-brand`} aria-label="Vaanlekha">
    <BrandMark /><span className="saathi-wordmark">Vaanlekha</span>
  </Link>;
}
