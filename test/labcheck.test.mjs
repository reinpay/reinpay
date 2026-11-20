// v0.51.1: the offline check must agree with the real lab run (real rules plus mainnet simulation) for every rule set.
import { readFileSync } from "node:fs";
import { checkOffline, ROWS, attacks, ANTIDOTE } from "../src/labcore.js";
let pass = 0, fail = 0;
const check = (label, cond, info = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"} ${label}${info ? ` (${info})` : ""}`); };
const A = attacks(0.37);
// the recorded outcomes of a real run (block 118909899), for the same seven scams and five rule sets
const REAL = { none: "bpbbppp", default: "bpbbhbp", balanced: "bpbbhbp", cautious: "bhbbbbh", hardened: "bbbbbbb" };
for (const [id, row] of Object.entries(ROWS)) {
  const rules = Object.fromEntries(Object.entries(row.rules).filter(([, v]) => v !== undefined));
  const got = checkOffline({ autoSend: false, ...rules }, A).map((c) => c.outcome[0]).join("");
  check(`${row.label}: the offline check matches the mainnet run`, got === REAL[id], `${got} vs ${REAL[id]}`);
}
const one = checkOffline({ daily: { ETH: 0.005 }, maxPerPayment: { ETH: 0.002 }, approveAbove: { ETH: 0.001 }, repeatGuardMinutes: 10, memoBlock: ["airdrop", "claim", "unlock", "verify wallet"], maxPerDay: 6 }, A);
check("default rules plus blocked memo words and a daily count stop all seven", one.every((c) => c.outcome !== "paid"), one.map((c) => c.outcome[0]).join(""));
check("the token contract is always refused by the token check, whatever the rules", checkOffline({ daily: { ETH: 100 }, maxPerPayment: { ETH: 100 } }, A).find((c) => c.attack === "token").rule === "token contract");
check("every attack has an antidote entry", A.every((a) => Array.isArray(ANTIDOTE[a.id])));
check("no budget for ETH: every scam is blocked by the daily budget or before", checkOffline({}, A).every((c) => c.outcome === "blocked"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
