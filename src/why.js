// reinpay why <RP-id>: replay the decision on one past payment, rule by rule, with the rules that were sealed at the
// time (from the rules history, v0.36) and the payments that came before it. Pure: the caller passes everything in.
import { getAddress } from "viem";
import { explain } from "./explain.js";

/** The snapshot sealed last at or before `t` (ms), or null when the history does not reach back that far. */
export function rulesAt(history, t) {
  let hit = null;
  for (const e of history || []) if (Date.parse(e.at) <= t) hit = e;
  return hit;
}

const OUTSIDE = { frozen: "the wallet was frozen", "token contract": "the payee was a token contract", simulation: "the mainnet simulation", "network fee": "the network fee from the simulation", "config seal": "the config seal at approval" };

/** Returns { receipt, source, at, steps, replayed, recorded, matches, note }. */
export function why({ receipt: r, receipts, history, current }) {
  const snap = rulesAt(history, r.createdAt);
  const body = snap ? snap.body : current, source = snap ? "history" : "current";
  const payee = r.payeeAddress ? (body.payees || []).find((p) => getAddress(p.address) === getAddress(r.payeeAddress)) || null : null;
  const before = receipts.filter((x) => x.createdAt < r.createdAt || (x.createdAt === r.createdAt && x.id < r.id));
  // Session caps are not kept on the receipt, so the session budget is not replayed (it says so below).
  const request = { payee, token: r.token, amountRaw: BigInt(r.amountRaw), memo: r.memo ?? "", usdRaw: r.usdRaw ?? undefined };
  const share = (body.rules || {}).balanceShare; // the balance at that moment is not kept, so this rule is not replayed
  const { steps, decision } = explain({ rules: { ...(body.rules || {}), balanceShare: undefined }, receipts: before, request, now: r.createdAt });
  const replayed = decision.status === "allowed" ? "within rules" : decision.rule;
  const recorded = r.rule;
  let note;
  if (OUTSIDE[recorded]) note = `This one was decided outside the rules list: by ${OUTSIDE[recorded]}. The rules alone would say: ${replayed}.`;
  else if (replayed === recorded) note = `The replay matches the receipt: ${recorded}.`;
  else note = `The replay says ${replayed}, the receipt says ${recorded}.${source === "current" ? " The rules history does not reach back to this payment, so today's rules were used." : " The receipt may have changed later (an approval refused on a second check)."}`;
  if (share) note += " The balance-share rule is not replayed: the balance at that moment is not kept.";
  if (r.session) note += " Its agent session's budget is not replayed: the session caps are not kept on receipts.";
  return { receipt: r.id, source, at: snap ? snap.at : null, steps, replayed, recorded, matches: replayed === recorded, note };
}
