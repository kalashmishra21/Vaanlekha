import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Sign in | Vaanlekha",
  robots: { index: false, follow: false },
};

export default function SignInLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
