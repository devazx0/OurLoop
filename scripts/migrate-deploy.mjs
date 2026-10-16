// Applies pending Prisma migrations during a production deploy.
//
// Safety properties:
//  - Only runs for Vercel production builds (VERCEL_ENV === "production").
//  - Uses `prisma migrate deploy`, which ONLY applies pending migrations. It
//    never resets, drops, or deletes data.
//  - Fails the build (exit 1) if migrations cannot be applied, so a broken
//    deployment is never promoted over the previous working one.
//
// Local `npm run build` and preview builds skip this entirely.
import { execSync } from "node:child_process";

const vercelEnv = process.env.VERCEL_ENV;

if (vercelEnv !== "production") {
  console.log(
    `[migrate] Skipping prisma migrate deploy (VERCEL_ENV=${vercelEnv ?? "undefined"}).`
  );
  process.exit(0);
}

if (!process.env.DIRECT_URL && !process.env.DATABASE_URL) {
  console.error(
    "[migrate] DIRECT_URL/DATABASE_URL is not configured for production; cannot apply migrations."
  );
  process.exit(1);
}

console.log("[migrate] Applying pending Prisma migrations (additive only)...");

try {
  execSync("npx prisma migrate deploy", { stdio: "inherit", env: process.env });
  console.log("[migrate] Migrations are up to date.");
} catch {
  console.error(
    "[migrate] Migration failed. Aborting the deploy so the existing deployment stays live."
  );
  process.exit(1);
}
