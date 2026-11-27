#!/usr/bin/env node
// Release-age check for the Rust crates in src-tauri/Cargo.lock (D-43): the Cargo counterpart of
// `min-release-age` in .npmrc, which Cargo has no setting for. Each crates.io package in the lockfile
// is looked up in the sparse index (index.crates.io), whose entries carry `pubtime`; a version published
// less than MIN_DAYS ago, or a yanked one, fails the check. Versions from before `pubtime` was recorded
// (2025) have none and count as old enough.
//
//   node scripts/cargo-release-age.mjs         check, exit 1 on a violation
//   node scripts/cargo-release-age.mjs --fix   also move each violation back to the newest compatible
//                                              version that passes (`cargo update --precise`), then recheck
//
// Extra arguments (file names from lint-staged) are ignored.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIN_DAYS = Number(process.env.CARGO_MIN_RELEASE_AGE_DAYS ?? 7);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, "src-tauri", "Cargo.toml");
const LOCK = join(ROOT, "src-tauri", "Cargo.lock");
const CRATES_IO = "registry+https://github.com/rust-lang/crates.io-index";
const cutoff = Date.now() - MIN_DAYS * 86_400_000;

function lockedPackages() {
  const text = readFileSync(LOCK, "utf8");
  const out = [];
  for (const block of text.split("[[package]]").slice(1)) {
    const field = (k) => block.match(new RegExp(`^${k} = "([^"]*)"`, "m"))?.[1];
    if (field("source") === CRATES_IO) out.push({ name: field("name"), version: field("version") });
  }
  return out;
}

function indexPath(name) {
  const n = name.toLowerCase();
  if (n.length <= 2) return `${n.length}/${n}`;
  if (n.length === 3) return `3/${n[0]}/${n}`;
  return `${n.slice(0, 2)}/${n.slice(2, 4)}/${n}`;
}

const indexCache = new Map();
function indexEntries(name) {
  if (!indexCache.has(name)) {
    indexCache.set(
      name,
      (async () => {
        for (let attempt = 1; ; attempt++) {
          try {
            const res = await fetch(`https://index.crates.io/${indexPath(name)}`, {
              headers: { "User-Agent": "cargo-release-age-check" },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.text();
            return body
              .split("\n")
              .filter(Boolean)
              .map((l) => JSON.parse(l));
          } catch (e) {
            if (attempt >= 3) throw new Error(`index lookup for ${name} failed: ${e.message}`, { cause: e });
          }
        }
      })(),
    );
  }
  return indexCache.get(name);
}

function parseVersion(v) {
  const [core, pre] = v.split("+")[0].split(/-(.*)/s);
  return { nums: core.split(".").map(Number), pre: pre ?? "" };
}
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}
// Cargo's caret compatibility: 1.x.y within the major, 0.x.y within the minor, 0.0.z exact.
function compatKey(v) {
  const [maj, min, pat] = parseVersion(v).nums;
  return maj > 0 ? `${maj}` : min > 0 ? `0.${min}` : `0.0.${pat}`;
}
const oldEnough = (entry) => !entry.pubtime || Date.parse(entry.pubtime) <= cutoff;

async function findViolations() {
  const pkgs = lockedPackages();
  const violations = [];
  const queue = [...pkgs];
  const worker = async () => {
    for (let p; (p = queue.shift());) {
      const entries = await indexEntries(p.name);
      const entry = entries.find((e) => e.vers === p.version);
      if (!entry) {
        violations.push({ ...p, reason: "not in the crates.io index" });
      } else if (entry.yanked) {
        violations.push({ ...p, reason: "yanked", entries });
      } else if (!oldEnough(entry)) {
        violations.push({ ...p, reason: `published ${entry.pubtime}`, entries });
      }
    }
  };
  await Promise.all(Array.from({ length: 16 }, worker));
  return { count: pkgs.length, violations };
}

function fallbackVersion(v) {
  if (!v.entries) return undefined;
  const key = compatKey(v.version);
  const allowPre = parseVersion(v.version).pre !== "";
  return v.entries
    .filter((e) => !e.yanked && oldEnough(e) && compatKey(e.vers) === key)
    .filter((e) => allowPre || !parseVersion(e.vers).pre)
    .filter((e) => compareVersions(e.vers, v.version) < 0)
    .map((e) => e.vers)
    .sort(compareVersions)
    .at(-1);
}

const fix = process.argv.includes("--fix");
for (let round = 1; ; round++) {
  const { count, violations } = await findViolations();
  if (violations.length === 0) {
    console.log(`cargo-release-age: all ${count} crates.io packages are at least ${MIN_DAYS} days old.`);
    process.exit(0);
  }
  violations.sort((a, b) => a.name.localeCompare(b.name));
  for (const v of violations) {
    const to = fallbackVersion(v);
    console.log(`  ${v.name} ${v.version}: ${v.reason}${to ? ` -> ${to}` : ""}`);
  }
  if (!fix || round > 5) {
    console.error(
      `cargo-release-age: ${violations.length} package(s) are newer than ${MIN_DAYS} days or yanked.` +
        (fix ? "" : " Run `node scripts/cargo-release-age.mjs --fix` to move them back."),
    );
    process.exit(1);
  }
  let changed = false;
  for (const v of violations) {
    const to = fallbackVersion(v);
    if (!to) continue;
    // An earlier move in this round may already have changed it (e.g. jiff takes jiff-static along).
    if (!lockedPackages().some((p) => p.name === v.name && p.version === v.version)) {
      changed = true;
      continue;
    }
    try {
      execFileSync(
        "cargo",
        ["update", "--manifest-path", MANIFEST, "--package", `${v.name}@${v.version}`, "--precise", to],
        { stdio: "inherit" },
      );
      changed = true;
    } catch {
      console.error(`  could not move ${v.name} to ${to} (a dependent may require the newer version)`);
    }
  }
  if (!changed) process.exit(1);
}
