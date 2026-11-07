import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import nextEnv from "@next/env";

const root = process.cwd();
const { loadEnvConfig } = nextEnv;
loadEnvConfig(root);

const secretNames = [
  "GEMINI_API_KEY",
  "OPENROUTER_API_KEY",
  "GNANI_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_DB_PASSWORD",
];
const configuredSecrets = secretNames
  .map((name) => process.env[name]?.trim())
  .filter((value) => value && value.length >= 8);
const publicSecretName = /\bNEXT_PUBLIC_(?:GEMINI_API_KEY|OPENROUTER_API_KEY|GNANI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_DB_PASSWORD)\b/;
const secretPatterns = [
  { label: "Google API key format", pattern: /AIza[0-9A-Za-z_-]{35}/ },
  { label: "OpenRouter API key format", pattern: /sk-or-v1-[0-9a-fA-F]{64}/ },
  { label: "Supabase secret key format", pattern: /sb_secret_[0-9A-Za-z_-]{30,}/ },
];
const assignmentPattern = new RegExp(`\\b(${secretNames.join("|")})\\s*[:=]\\s*[\\"'\\x60]?\\s*([^\\s\\"'\\x60#]+)`, "g");
const placeholderPattern = /^(?:$|\$\{|\$[A-Z_][A-Z0-9_]*$|<|your[_-]|example|sample|placeholder|changeme|change-me|test[_-]?key|fake[_-]?key|redacted)/i;
const findings = new Set();
let browserFilesScanned = 0;

function scanText(label, text) {
  if (configuredSecrets.some((secret) => text.includes(secret))) findings.add(`${label}: configured secret value`);
  if (publicSecretName.test(text)) findings.add(`${label}: private key named as a public variable`);
  for (const { label: patternLabel, pattern } of secretPatterns) {
    if (pattern.test(text)) findings.add(`${label}: ${patternLabel}`);
  }
  const filePath = label.replace(/^Git history /, "");
  const isEnvironmentFile = /(?:^|\/)\.env(?:\.|$)/i.test(filePath) && !/\.example$/i.test(filePath);
  if (isEnvironmentFile) {
    assignmentPattern.lastIndex = 0;
    for (const match of text.matchAll(assignmentPattern)) {
      if (!placeholderPattern.test(match[2])) findings.add(`${label}: non-placeholder ${match[1]} assignment`);
    }
  }
}

function collectFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(target));
    else if (entry.isFile()) files.push(target);
  }
  return files;
}

function gitOutput(args, options = {}) {
  return execFileSync("git", args, { cwd: root, maxBuffer: 512 * 1024 * 1024, ...options });
}

function scanGitHistory() {
  const objectLines = gitOutput(["rev-list", "--objects", "--all"], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
  const objectPaths = new Map();
  const objectIds = [];
  for (const line of objectLines) {
    const separator = line.indexOf(" ");
    const sha = separator < 0 ? line : line.slice(0, separator);
    if (!objectPaths.has(sha)) objectPaths.set(sha, separator < 0 ? "(history object)" : line.slice(separator + 1));
    objectIds.push(sha);
  }

  const details = gitOutput(["cat-file", "--batch-check=%(objectname) %(objecttype)"], {
    input: `${objectIds.join("\n")}\n`,
    encoding: "utf8",
  });
  const blobs = details.split("\n").flatMap((line) => {
    const [sha, type] = line.split(" ");
    return type === "blob" ? [sha] : [];
  });
  const batch = spawnSync("git", ["cat-file", "--batch"], {
    cwd: root,
    input: Buffer.from(`${blobs.join("\n")}\n`),
    maxBuffer: 512 * 1024 * 1024,
  });
  if (batch.error) throw batch.error;
  if (batch.status !== 0 || !batch.stdout) throw new Error("Git history scan could not read repository blobs.");

  const data = batch.stdout;
  let offset = 0;
  while (offset < data.length) {
    const lineEnd = data.indexOf(10, offset);
    if (lineEnd < 0) break;
    const header = data.subarray(offset, lineEnd).toString("utf8").split(" ");
    const sha = header[0];
    const size = Number(header[2]);
    if (header[1] !== "blob" || !Number.isSafeInteger(size)) throw new Error("Git history scan returned an unreadable object.");
    const contentStart = lineEnd + 1;
    const contentEnd = contentStart + size;
    if (contentEnd > data.length) throw new Error("Git history scan returned a truncated object.");
    scanText(`Git history ${objectPaths.get(sha) ?? sha}`, data.subarray(contentStart, contentEnd).toString("utf8"));
    offset = contentEnd + 1;
  }
}

const trackedPaths = gitOutput(["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" })
  .split("\0").filter(Boolean);
if (trackedPaths.includes(".env.local")) findings.add(".env.local: tracked by Git");
const ignored = spawnSync("git", ["check-ignore", "--quiet", ".env.local"], { cwd: root }).status === 0;
if (!ignored) findings.add(".env.local: not ignored by Git");

for (const relativePath of trackedPaths) {
  if (relativePath === ".env.local") continue;
  try { scanText(relativePath, readFileSync(path.join(root, relativePath)).toString("utf8")); }
  catch { findings.add(`${relativePath}: could not be scanned`); }
}

for (const file of collectFiles(path.join(root, ".next", "static"))) {
  browserFilesScanned++;
  try { scanText(path.relative(root, file), readFileSync(file).toString("utf8")); }
  catch { findings.add(`${path.relative(root, file)}: could not be scanned`); }
}

scanGitHistory();

if (findings.size > 0) {
  console.error(`Secret scan failed with ${findings.size} sanitized finding(s):`);
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log(`Secret scan passed. .env.local is ignored and untracked; ${trackedPaths.length} worktree file(s), reachable Git history, and ${browserFilesScanned} browser asset(s) checked. No secret values are printed.`);
}
