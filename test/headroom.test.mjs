// v0.38: reinpay headroom, offline. Every number must agree with decide() on both sides of it.
import { parseUnits } from "viem";
import { decide } from "../src/rules.js";
import { headroom, headroomLines } from "../src/headroom.js";
let pass = 0, fail = 0;
const check = (label, cond, info = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"} ${label}${info ? ` (${info})` : ""}`); };
const NOW = Date.parse("2026-11-20T12:00:00"), eth = (x) => parseUnits(String(x), 18), usdg = (x) => parseUnits(String(x), 6);
const W = "0x000000000000000000000000000000000000dEaD", G = "0x00000000000000000000000000000000DeaDBeef";
const rules = { daily: { USDG: 25, ETH: 0.005 }, maxPerPayment: { USDG: 10, ETH: 0.002 }, approveAbove: { USDG: 5, ETH: 0.001 }, repeatGuardMinutes: 10 };
const payees = [{ name: "Weather API", address: W }, { name: "GPU credits", address: G, daily: { ETH: "0.0015" } }, { name: "Off", address: "0x0000000000000000000000000000000000000001", disabled: true }];
const rc = (o) => ({ id: "RP-1", payeeAddress: W, token: "ETH", amountRaw: eth("0.002").toString(), createdAt: NOW - 60_000, status: "needs_approval", ...o });
const receipts = [rc({}), rc({ id: "RP-2", payeeAddress: G, amountRaw: eth("0.0015").toString() }), rc({ id: "RP-3", amountRaw: eth("0.001").toString(), status: "ready" })];
const rows = headroom({ rules, receipts, payees, now: NOW });
const row = (p, t) => rows.find((r) => r.payee === p && r.token === t);
check("a switched-off payee gets no rows", !rows.some((r) => r.payee === "Off"));
check("fresh USDG: 5 without you (the approval line), 10 with you (the max)", row("Weather API", "USDG").free === usdg(5) && row("Weather API", "USDG").withYou === usdg(10) && row("Weather API", "USDG").freeStop === "approval line" && row("Weather API", "USDG").stop === "max per payment");
check("ETH after 0.0045 waiting: only 0.0005 left of the daily budget", row("Weather API", "ETH").free === eth("0.0005") && row("Weather API", "ETH").withYou === eth("0.0005") && row("Weather API", "ETH").stop === "daily budget");
check("a payee whose own daily budget is used up: nothing right now", row("GPU credits", "ETH").withYou === 0n && row("GPU credits", "ETH").stop === "payee daily budget");
// both sides of every number agree with decide()
let bad = 0;
const r0 = { ...rules, repeatGuardMinutes: 0 };
for (const r of rows) {
  const p = payees.find((x) => x.name === r.payee), D = (a) => decide({ rules: r0, receipts, request: { payee: p, token: r.token, amountRaw: a }, now: NOW }).status;
  if (r.free > 0n && D(r.free) !== "allowed") bad++;
  if (r.withYou > 0n && D(r.withYou) === "blocked") bad++;
  if (D(r.withYou + 1n) !== "blocked") bad++;
  if (r.free < r.withYou && D(r.free + 1n) === "allowed") bad++;
}
check("every number agrees with decide() at the number and one unit above it", bad === 0, `${bad} disagreements`);
const sw = headroom({ rules: { ...rules, firstPayment: "ask" }, receipts: [], payees: [payees[0]], now: NOW });
check("first payment asks: nothing without you, the rest with your yes", sw[0].free === 0n && sw[0].freeStop === "first payment" && sw[0].withYou === eth("0.002"));
const notok = headroom({ rules: { ...rules, daily: { USDG: 25 } }, receipts: [], payees: [payees[0]], now: NOW });
check("a token without a daily budget is left out", !notok.some((r) => r.token === "ETH") && notok.some((r) => r.token === "USDG"));
const lines = headroomLines(rows).join("\n");
check("the lines read the way the owner would say it", lines.includes("up to 5 USDG without asking you, up to 10 USDG with your yes; above that: max per payment") && lines.includes("nothing right now: payee daily budget"), lines.split("\n")[2]);
const usdRows = headroom({ rules: { ...rules, usd: { max: 3 } }, receipts: [], payees: [payees[0]], now: NOW, usdFor: (t, a) => (t === "USDG" ? { usdRaw: a.toString() } : { usdRaw: ((a * 2000_000000n) / 10n ** 18n).toString() }) });
const usdOf = (a) => (a * 2000_000000n) / 10n ** 18n, e = usdRows.find((r) => r.token === "ETH").withYou;
check("dollar limits count: USDG stops at 3; ETH at the last wei still worth 3 USD at 2000 (values round down to 0.000001 USD)", usdRows.find((r) => r.token === "USDG").withYou === usdg(3) && usdOf(e) === 3_000000n && usdOf(e + 1n) > 3_000000n, e.toString());
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
