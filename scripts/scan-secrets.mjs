/**
 * Fail when a tracked text file looks like it contains a real secret.
 * Prints the file and line only. It does not print the matching text.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execSync("git ls-files", { encoding: "utf8" })
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

const patterns = [
  /sk-[A-Za-z0-9]{20,}/,
  /sk-proj-[A-Za-z0-9_-]{10,}/,
  /AKIA[0-9A-Z]{16}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /AIza[0-9A-Za-z_-]{20,}/,
];

const binary = /\.(png|jpe?g|gif|webp|ico|woff2?)$/i;
let failed = false;

for (const file of files) {
  if (file === ".env") {
    console.error(".env is tracked");
    failed = true;
    continue;
  }
  if (file === "package-lock.json" || binary.test(file)) continue;
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (patterns.some((pattern) => pattern.test(line))) {
      console.error(`${file}:${index + 1}: possible secret`);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log(`Scanned ${files.length} tracked files.`);
