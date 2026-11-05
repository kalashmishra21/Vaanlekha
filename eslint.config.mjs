import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", ".next-dev-*/**", ".next-prod/**", ".next-prod-*/**", ".agents/**", ".playwright-cli/**", "prototypes/**/node_modules/**", "prototypes/**/evidence/**", "prototypes/**/*.bundle.js", "out/**", "build/**", "next-env.d.ts"]),
]);
