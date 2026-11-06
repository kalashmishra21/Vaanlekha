import { z } from "zod";

const publicConfigSchema = z.object({
  url: z.url().refine((value) => value.startsWith("https://") || value.startsWith("http://localhost:") || value.startsWith("http://127.0.0.1:")),
  key: z.string().min(10),
});

export type SupabasePublicConfig = z.infer<typeof publicConfigSchema>;

export function normalizeSupabaseProjectUrl(value: string): string {
  const url = new URL(value);
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "" || path === "/rest/v1") return url.origin;
  return value.replace(/\/+$/, "");
}

export function getSupabaseConfig(): SupabasePublicConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  const parsed = publicConfigSchema.safeParse({ url, key });
  if (!parsed.success) throw new Error("Supabase public URL or key is invalid.");
  return { ...parsed.data, url: normalizeSupabaseProjectUrl(parsed.data.url) };
}
