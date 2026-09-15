/**
 * `vinext build` regenerates dist/server/wrangler.json on every run, carrying the
 * template's worker name and a placeholder D1 id. Hand-edits do not survive a
 * rebuild, so patch the generated config here and deploy that file.
 *
 * Usage:
 *   CF_D1_DATABASE_ID=<uuid> [WORKER_NAME=ap-desk] node scripts/deploy.mjs [--dry-run]
 */
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const CONFIG = "dist/server/wrangler.json";
const databaseId = process.env.CF_D1_DATABASE_ID;
const workerName = process.env.WORKER_NAME || "ap-desk";
const databaseName = process.env.CF_D1_DATABASE_NAME || "ap-desk-db";
const dryRun = process.argv.includes("--dry-run");

if (!databaseId) {
  console.error("CF_D1_DATABASE_ID is required. Create the database first:\n" +
    `  npx wrangler d1 create ${databaseName}\n` +
    "then re-run with the uuid it prints.");
  process.exit(1);
}

let config;
try {
  config = JSON.parse(await readFile(CONFIG, "utf8"));
} catch {
  console.error(`${CONFIG} not found. Run \`npm run build\` first.`);
  process.exit(1);
}

config.name = workerName;
config.topLevelName = workerName;
config.d1_databases = [{ binding: "DB", database_name: databaseName, database_id: databaseId }];

await writeFile(CONFIG, JSON.stringify(config));
console.log(`Patched ${CONFIG}: worker "${workerName}", D1 "${databaseName}" (${databaseId.slice(0, 8)}…)`);

if (dryRun) {
  console.log("--dry-run: stopping before deploy.");
  process.exit(0);
}

const result = spawnSync("npx", ["wrangler", "deploy", "-c", CONFIG], { stdio: "inherit" });
process.exit(result.status ?? 1);
