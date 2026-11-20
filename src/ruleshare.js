// Share rules between wallets. `reinpay rules export` writes your rules to a file signed with your wallet key;
// `reinpay rules import <file>` checks the signature, shows who signed it and every change (now → then), and applies
// them only after you type yes. Grants, the co-signer and autosend are never taken from a file.
import { keccak256, toBytes, recoverMessageAddress, getAddress } from "viem";
import { canon } from "./seal.js";
import { diff } from "./history.js";

export const SHARED = ["daily", "maxPerPayment", "approveAbove", "weekly", "monthly", "repeatGuardMinutes", "maxPerHour", "maxPerDay", "balanceShare", "memoMin", "memoBlock", "firstPayment", "hours", "expireAfterMinutes", "categories", "usd", "maxFeeEth", "requireProven", "breaker"];

export const rulesFileMessage = (f) => { const { signature, ...body } = f; return "Reinpay rules file v1\n" + keccak256(toBytes(JSON.stringify(canon(body)))); };

export async function exportRules(rules, account, now = Date.now()) {
  const shared = Object.fromEntries(SHARED.filter((k) => rules?.[k] !== undefined).map((k) => [k, rules[k]]));
  const body = { kind: "reinpay-rules", version: 1, by: getAddress(account.address), at: new Date(now).toISOString(), rules: shared };
  return { ...body, signature: await account.signMessage({ message: rulesFileMessage(body) }) };
}

/** { ok, signer, reason } */
export async function checkRulesFile(f) {
  if (f?.kind !== "reinpay-rules" || f.version !== 1 || !f.rules || typeof f.rules !== "object") return { ok: false, reason: "not a Reinpay rules file (v1)" };
  if (!f.signature) return { ok: false, reason: "not signed" };
  const extra = Object.keys(f.rules).filter((k) => !SHARED.includes(k));
  if (extra.length) return { ok: false, reason: `it carries settings a rules file may not set: ${extra.join(", ")}` };
  try {
    const signer = getAddress(await recoverMessageAddress({ message: rulesFileMessage(f), signature: f.signature }));
    if (signer !== getAddress(f.by)) return { ok: false, signer, reason: `the file does not match its signature: it was changed after ${f.by} signed it, or someone else signed it` };
    return { ok: true, signer, reason: `signed by ${signer}` };
  } catch { return { ok: false, reason: "the signature is not valid" }; }
}

/** Pure: the rules after an import, and the changes. Shared settings missing from the file are turned off. */
export function planRulesImport(f, current) {
  const next = { ...current };
  for (const k of SHARED) { if (f.rules[k] === undefined) delete next[k]; else next[k] = f.rules[k]; }
  return { rules: next, changes: diff({ rules: current }, { rules: next }) };
}
