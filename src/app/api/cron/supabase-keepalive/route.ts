import "server-only";

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getSupabaseConfig } from "@/lib/supabase/config";

export const runtime = "nodejs";
export const maxDuration = 15;

const REQUEST_TIMEOUT_MS = 8_000;
const MIN_SECRET_LENGTH = 16;

let executionInProgress = false;

function matchesCronSecret(authorization: string | null, secret: string): boolean {
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(secret, "utf8");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function logExecution(status: string, error?: string) {
  console.info("supabase_keepalive", {
    status,
    timestamp: new Date().toISOString(),
    ...(error ? { error } : {}),
  });
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    logExecution("failed", "cron_secret_not_configured");
    return NextResponse.json({ error: "Keep-alive is not configured." }, { status: 503 });
  }

  if (!matchesCronSecret(request.headers.get("authorization"), secret)) {
    logExecution("rejected");
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (executionInProgress) {
    logExecution("skipped_overlap");
    return NextResponse.json({ ok: true, skipped: true }, { status: 202 });
  }

  executionInProgress = true;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    const config = getSupabaseConfig();
    if (!config) {
      logExecution("failed", "supabase_public_config_missing");
      return NextResponse.json({ error: "Keep-alive is not configured." }, { status: 503 });
    }

    const client = createClient(config.url, config.key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const databaseRequest = client
      .from("shops")
      .select("id", { head: true })
      .limit(1)
      .abortSignal(controller.signal);

    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new Error("keepalive_timeout"));
      }, REQUEST_TIMEOUT_MS);
    });

    const { error } = await Promise.race([databaseRequest, deadline]);
    if (error) {
      logExecution("failed", "database_request_failed");
      return NextResponse.json({ error: "Database health check failed." }, { status: 503 });
    }

    logExecution("succeeded");
    return NextResponse.json({ ok: true });
  } catch {
    const error = controller.signal.aborted ? "database_request_timeout" : "database_request_failed";
    logExecution("failed", error);
    return NextResponse.json({ error: "Database health check failed." }, { status: 503 });
  } finally {
    if (timeout) clearTimeout(timeout);
    executionInProgress = false;
  }
}
