// v0.50: reinpay selftest, offline. Runs two tiny fake test files from a temporary folder.
import { mkdtempSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSelftest, countOutput, testDir } from "../src/selftest.js";
let pass = 0, fail = 0;
const check = (label, cond, info = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"} ${label}${info ? ` (${info})` : ""}`); };
check("counts PASS and FAIL lines and keeps the failures", JSON.stringify(countOutput("PASS a\nFAIL b (x)\nPASS c\nnoise")) === JSON.stringify({ pass: 2, fail: 1, failures: ["b (x)"] }));
const dir = mkdtempSync(join(tmpdir(), "reinpay-selftest-fake-"));
const parentHome = process.env.REINPAY_HOME || "(unset)";
writeFileSync(join(dir, "a.test.mjs"), `const h = process.env.REINPAY_HOME; console.log((h && h !== ${JSON.stringify(parentHome)} && h.includes("reinpay-selftest-")) ? "PASS own temporary home" : "FAIL shared home " + h); console.log("PASS second");`);
writeFileSync(join(dir, "b.test.mjs"), `console.log("PASS one"); console.log("FAIL two (broken)"); process.exit(1);`);
writeFileSync(join(dir, "c.test.mjs"), `throw new Error("crashed on purpose");`);
writeFileSync(join(dir, "notatest.mjs"), `console.log("FAIL should not run");`);
const seen = [];
const r = runSelftest({ dir, onFile: (x) => seen.push(x.file) });
check("only *.test.mjs files run, in order, each reported as it finishes", r.files === 3 && seen.join(",") === "a.test.mjs,b.test.mjs,c.test.mjs");
check("each file gets its own temporary REINPAY_HOME, never the caller's", r.results[0].ok && r.results[0].pass === 2);
check("totals add up and a failure makes the run not ok", r.pass === 3 && r.fail === 1 && !r.ok && r.results[1].failures[0] === "two (broken)");
check("a file that crashes without FAIL lines is reported with its error", !r.results[2].ok && /crashed on purpose/.test(r.results[2].error || ""), r.results[2].error);
check("the tests ship next to the code", readdirSync(testDir()).some((f) => f === "selftest.test.mjs"));
let e = ""; try { runSelftest({ dir: join(dir, "missing") }); } catch (x) { e = x.message; }
check("no tests folder: it says so", /No tests next to this install/.test(e));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
