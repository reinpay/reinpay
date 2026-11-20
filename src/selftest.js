// reinpay selftest: run the tests that ship with Reinpay, here, on this computer. Each test file runs in its own
// process with a fresh temporary REINPAY_HOME, so your real ~/.reinpay is never read or touched.
// The offline tests need no network; --live adds the mainnet tests (reads and simulations only, nothing is signed).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const testDir = () => fileURLToPath(new URL("../test/", import.meta.url));

/** Pure: one file's output → { pass, fail, failures } */
export function countOutput(text) {
  const lines = String(text).split("\n");
  const fails = lines.filter((l) => l.startsWith("FAIL "));
  return { pass: lines.filter((l) => l.startsWith("PASS ")).length, fail: fails.length, failures: fails.map((l) => l.slice(5)) };
}

export function runSelftest({ live = false, onFile = () => {}, dir = testDir() } = {}) {
  if (!existsSync(dir)) throw new Error(`No tests next to this install (${dir}). Install Reinpay from GitHub to get them.`);
  const files = readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).sort().concat(live ? ["live.mjs"] : []);
  const results = [], t0 = Date.now();
  for (const f of files) {
    const home = mkdtempSync(join(tmpdir(), "reinpay-selftest-"));
    const env = { ...process.env, REINPAY_HOME: home }; delete env.REINPAY_PROFILE;
    const t = Date.now(), p = spawnSync(process.execPath, [join(dir, f)], { env, encoding: "utf8", timeout: f === "live.mjs" ? 900_000 : 180_000 });
    rmSync(home, { recursive: true, force: true });
    const c = countOutput((p.stdout || "") + "\n" + (p.stderr || ""));
    const r = { file: f, ...c, ok: p.status === 0 && c.fail === 0, seconds: Math.round((Date.now() - t) / 100) / 10, ...(p.status !== 0 && !c.fail ? { error: (p.error?.message || (p.stderr || "").split("\n").filter((l) => /Error/.test(l)).at(-1)?.trim() || (p.stderr || "").trim().split("\n").at(-1) || `exit ${p.status}`).slice(0, 200) } : {}) };
    results.push(r); onFile(r);
  }
  const pass = results.reduce((s, r) => s + r.pass, 0), fail = results.reduce((s, r) => s + r.fail, 0);
  return { files: results.length, pass, fail, ok: results.every((r) => r.ok), seconds: Math.round((Date.now() - t0) / 1000), results };
}
