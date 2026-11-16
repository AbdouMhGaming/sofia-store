import { spawnSync } from "node:child_process";
for (const key of ["DB_HOST", "DB_NAME", "DB_USER", "DB_PASS"]) {
  if (!process.env[key]) throw new Error(`Missing ${key}`);
}
const url = `mysql://${encodeURIComponent(process.env.DB_USER)}:${encodeURIComponent(process.env.DB_PASS)}@${process.env.DB_HOST}:${process.env.DB_PORT || 3306}/${encodeURIComponent(process.env.DB_NAME)}?sslaccept=strict`;
// Capture Prisma output: its datasource banner can include connection details.
const child = spawnSync("pnpm", ["exec", "prisma", ...process.argv.slice(2)], {
  env: { ...process.env, SOFIA_MYSQL_URL: url },
  encoding: "utf8",
});
const output = `${child.stdout || ""}\n${child.stderr || ""}`;
if (child.status !== 0) {
  const codes = [...new Set(output.match(/\bP\d{4}\b/g) || [])];
  console.error("Prisma command failed.", codes.join(", ") || "No Prisma error code returned.");
  process.exit(1);
}
console.log("Prisma command completed successfully.");
