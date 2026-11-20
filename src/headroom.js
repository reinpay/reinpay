// reinpay headroom: for each payee and token, the largest amount the agent could ask for right now that would go
// through without you, and the largest that would at least wait for you. Found by asking decide() itself (a binary
// search over the amount), so it cannot disagree with a real decision. Pure: no network, no files.
import { decide, fmt } from "./rules.js";
import { TOKENS } from "./chain.js";

/** Largest amount in [0, hi] for which ok(decide(amount)) holds, assuming it holds for small amounts and not above. */
function largest(hi, ok) {
  if (hi <= 0n || !ok(1n)) return 0n;
  let lo = 1n;
  if (ok(hi)) return hi;
  while (hi - lo > 1n) { const mid = (lo + hi) / 2n; if (ok(mid)) lo = mid; else hi = mid; }
  return lo;
}

/**
 * Returns one row per payee and token: { payee, token, free, withYou, freeStop, stop } where free / withYou are base
 * units (bigint), freeStop is the rule that makes a payment just above `free` wait or stop, and stop the rule that
 * blocks just above `withYou`. The repeat guard is left out: it is about one exact amount, not a limit.
 */
export function headroom({ rules, receipts, payees, now = Date.now(), usdFor = null }) {
  const r0 = { ...rules, repeatGuardMinutes: 0, memoMin: 0 }, rows = [];
  for (const p of payees.filter((x) => !x.disabled)) {
    for (const t of Object.keys(TOKENS)) {
      if (p.tokens && !p.tokens.includes(t)) continue;
      const D = (amountRaw) => decide({ rules: r0, receipts, request: { payee: p, token: t, amountRaw, ...(usdFor ? usdFor(t, amountRaw) : {}) }, now });
      const cap = 10n ** BigInt(TOKENS[t].decimals + 12); // far above any budget: the rules, not this number, set the limit
      const withYou = largest(cap, (a) => D(a).status !== "blocked");
      const free = largest(withYou, (a) => D(a).status === "allowed");
      if (withYou === 0n && D(1n).status === "blocked" && /no daily budget|not a token|may only be paid/.test(D(1n).reason)) continue;
      const above = (a) => D(a + 1n);
      rows.push({ payee: p.name, token: t, free, withYou, freeStop: free < withYou ? above(free).rule : withYou > 0n ? null : D(1n).rule, stop: above(withYou).rule });
    }
  }
  return rows;
}

export function headroomLines(rows) {
  if (!rows.length) return ["Nothing can be paid right now: no payee has a token with a budget."];
  const n = (v, t) => fmt(v, t), pw = Math.max(...rows.map((r) => r.payee.length)), L = [];
  for (const r of rows) {
    if (r.withYou === 0n) { L.push(`  ${r.payee.padEnd(pw)}  ${r.token.padEnd(4)}  nothing right now: ${r.stop}`); continue; }
    const a = r.free > 0n ? `up to ${n(r.free, r.token)} without asking you` : `nothing without asking you${r.freeStop ? ` (${r.freeStop})` : ""}`;
    const b = r.withYou > r.free ? `, up to ${n(r.withYou, r.token)} with your yes` : "";
    L.push(`  ${r.payee.padEnd(pw)}  ${r.token.padEnd(4)}  ${a}${b}; above that: ${r.stop}`);
  }
  return L;
}
