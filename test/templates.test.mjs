// v0.40: reinpay rules template, offline.
import { readFileSync } from "node:fs";
import { TEMPLATES, commandsFor, compare } from "../src/templates.js";
let pass = 0, fail = 0;
const check = (label, cond, info = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"} ${label}${info ? ` (${info})` : ""}`); };
const help = readFileSync(new URL("../bin/reinpay.js", import.meta.url), "utf8");
check("three templates: cautious, balanced, open", Object.keys(TEMPLATES).join(",") === "cautious,balanced,open");
for (const n of Object.keys(TEMPLATES)) {
  const cmds = commandsFor(n);
  const known = cmds.every((c) => { const m = /^reinpay rule ([a-z-]+) /.exec(c); return m && help.includes(`name === "${m[1]}"`) || /^reinpay rule (daily|max|approve-above) (USDG|ETH) [\d.]+$/.test(c); });
  check(`${n}: every printed command is one the CLI handles`, known, cmds.find((c) => !/^reinpay rule /.test(c)));
  check(`${n}: a wallet with exactly these rules matches it`, compare(TEMPLATES[n].rules, n).length === 0);
}
check("tighter always: cautious budgets and lines sit below open ones", ["daily", "maxPerPayment", "approveAbove"].every((k) => ["USDG", "ETH"].every((t) => TEMPLATES.cautious.rules[k][t] < TEMPLATES.open.rules[k][t])));
check("in every template the approval line is below the max, and the max below the daily budget", Object.values(TEMPLATES).every((t) => ["USDG", "ETH"].every((k) => t.rules.approveAbove[k] < t.rules.maxPerPayment[k] && t.rules.maxPerPayment[k] < t.rules.daily[k])));
const d = compare({ daily: { USDG: 25, ETH: 0.005 }, maxPerPayment: { USDG: 10, ETH: 0.002 }, approveAbove: { USDG: 5, ETH: 0.001 }, repeatGuardMinutes: 10 }, "cautious");
check("compared with the defaults, cautious lists each change as now → then", d.find((x) => x.what === "daily USDG").now === "25" && d.find((x) => x.what === "daily USDG").then === "10" && d.find((x) => x.what === "first payment").then === "ask", d.length + " changes");
let e = ""; try { commandsFor("yolo"); } catch (x) { e = x.message; }
check("an unknown template is refused and the names are listed", /No template "yolo"\. Pick one of: cautious, balanced, open/.test(e));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
