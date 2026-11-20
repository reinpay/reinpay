// v0.48: the rules in plain words, offline.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.REINPAY_HOME = mkdtempSync(join(tmpdir(), "reinpay-plain-"));
const { plainRules } = await import("../src/plain.js"), C = await import("../src/config.js"), P = await import("../src/pay.js");
let pass = 0, fail = 0;
const check = (label, cond, info = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"} ${label}${info ? ` (${info})` : ""}`); };
const has = (L, s) => L.some((l) => l === s);
const base = { rules: { daily: { USDG: 25, ETH: 0.005 }, maxPerPayment: { USDG: 10, ETH: 0.002 }, approveAbove: { USDG: 5, ETH: 0.001 }, repeatGuardMinutes: 10 }, payees: [{ name: "Weather API", address: "0x1" }, { name: "GPU credits", address: "0x2" }] };
const L = plainRules(base);
check("budgets, max and approval line read as sentences", has(L, "Your agent can spend up to 25 USDG and 0.005 ETH a day.") && has(L, "One payment can be at most 10 USDG or 0.002 ETH.") && has(L, "Above 5 USDG or 0.001 ETH, a payment waits for you."));
check("the payees and the defaults (breaker on, autosend off, simulation)", has(L, "Only these payees can be paid: Weather API and GPU credits.") && has(L, "If the agent is blocked 5 times in 10 minutes, Reinpay freezes itself.") && has(L, "Even payments inside every rule wait for you, because autosend is off.") && L.at(-1).includes("simulated on Robinhood Chain mainnet"));
const full = { rules: { ...base.rules, weekly: { USDG: 100 }, balanceShare: 5, usd: { max: 3 }, firstPayment: "ask", hours: { from: 9, to: 18, weekdays: true }, maxPerHour: 5, maxPerDay: 20, memoMin: 10, memoBlock: ["airdrop", "claim"], maxFeeEth: "0.0001", expireAfterMinutes: 1440, categories: { compute: { daily: { USDG: 8 } } }, breaker: "off", autoSend: true },
  payees: [{ name: "GPU credits", address: "0x2", daily: { ETH: "0.0015" }, approveAbove: { ETH: "0.0003" }, cooldownMinutes: 60, tokens: ["ETH"] }, { name: "Old", address: "0x3", disabled: true }] };
const F = plainRules(full, { frozen: { reason: "agent kept asking" } });
check("frozen comes first", F[0] === "Reinpay is frozen (agent kept asking): nothing is paid until you unfreeze it.");
check("every newer rule has its sentence", ["At most 100 USDG a week (weeks start on Monday).", "One payment can be at most 5% of the wallet's balance of that token.", "One payment can be worth at most 3 USD.", "The first payment to every payee waits for you.", "Outside 9:00 to 18:00 on weekdays, every payment waits for you.", "At most 5 payments an hour.", "At most 20 payments a day.", "Every payment needs a memo of at least 10 characters saying what it is for.", "While the network fee is above 0.0001 ETH, payments are blocked.", "A payment left waiting for 24 hours expires.", "Payees in \"compute\" share 8 USDG a day."].every((s) => has(F, s)), F.find((l) => !l));
check("blocked memo words are counted, never listed", has(F, "A memo with one of 2 words or phrases you block is refused.") && !F.join(" ").includes("airdrop"));
check("a payee's own limits in one sentence; switched-off payees left out", has(F, "GPU credits: at most 0.0015 ETH a day; asks you above 0.0003 ETH; at least 60 minutes between payments; only in ETH.") && has(F, "Only these payees can be paid: GPU credits."));
check("breaker off and autosend on are said plainly", has(F, "The circuit breaker is off.") && has(F, "Payments inside every rule are sent without asking you, while the wallet is unlocked."));
check("no budget and no payees are said too", has(plainRules({ rules: {}, payees: [] }), "Your agent has no daily budget, so it cannot spend anything.") && has(plainRules({ rules: {}, payees: [] }), "There are no payees yet, so nothing can be paid."));
C.saveConfig({ ...C.DEFAULT_CONFIG, rules: { ...C.DEFAULT_CONFIG.rules, memoBlock: ["airdrop"] } });
const v = P.rulesView();
check("get_rules gives the agent the same sentences, still without the blocked words", Array.isArray(v.inPlainWords) && v.inPlainWords[0].startsWith("Your agent can spend") && !JSON.stringify(v).includes("airdrop"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
