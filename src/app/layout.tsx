import type { Metadata } from "next";
import localFont from "next/font/local";
import { publicSiteUrl } from "@/lib/seo/site-url";
import "./globals.css";
import "./landing.css";
import "./workspace.css";
import "./assistant.css";
import "./business.css";
import "./phase9.css";
import "./phase11.css";
import "./stage13.css";
import "./stage14.css";
import "./stage20.css";
import "./stage22.css";

const manrope = localFont({
  src: "../../node_modules/@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2",
  variable: "--font-manrope",
  display: "swap",
  weight: "200 800",
});
const newsreader = localFont({
  src: [
    { path: "../assets/fonts/newsreader-400-normal.woff2", style: "normal", weight: "400" },
    { path: "../assets/fonts/newsreader-400-italic.woff2", style: "italic", weight: "400" },
  ],
  variable: "--font-newsreader",
  display: "swap",
});

const siteUrl = publicSiteUrl();

export const metadata: Metadata = {
  metadataBase: siteUrl ?? new URL("http://localhost:3100"),
  applicationName: "Vaanlekha",
  title: "Vaanlekha — Your store, understood by voice",
  description: "A multilingual AI copilot for Indian retailers to manage inventory, khata and sales through natural conversation and trusted store tools.",
  robots: { index: Boolean(siteUrl), follow: Boolean(siteUrl) },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning className={`${manrope.variable} ${newsreader.variable}`}>
      <head><script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('dukaansaathi-theme');document.documentElement.dataset.theme=t==='light'||t==='dark'?t:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.sidebar=localStorage.getItem('dukaansaathi-sidebar')==='collapsed'?'collapsed':'expanded'}catch(e){document.documentElement.dataset.theme=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.sidebar='expanded'}` }} /></head>
      <body>{children}</body>
    </html>
  );
}
