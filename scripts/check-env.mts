/**
 * Check an environment's settings before deploying. Prints setting NAMES and problems only,
 * never values, so the output is safe to share.
 *
 *   node --env-file=.env.production.local scripts/check-env.mts
 *   (or paste nothing anywhere: run it with the same variables you'll put in Vercel)
 */
import { checkEnv } from "./env-rules.ts";

const findings = checkEnv(process.env);
const errors = findings.filter((f) => f.level === "error");
const warns = findings.filter((f) => f.level === "warn");
console.log(`Checking settings for APP_ENV=${process.env.APP_ENV ?? "(not set)"}\n`);
for (const f of errors) console.log(`✖ ${f.name}: ${f.problem}`);
for (const f of warns) console.log(`⚠ ${f.name}: ${f.problem}`);
if (!findings.length) console.log("✔ No problems found.");
console.log(`\n${errors.length} error(s), ${warns.length} warning(s).`);
process.exit(errors.length ? 1 : 0);
