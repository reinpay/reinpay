// reinpay x402 check <url>: read what an x402 service asks to be paid, and what your rules would say. It pays nothing.
// x402 (github.com/coinbase/x402): the service answers 402 with a PAYMENT-REQUIRED header (version 2, base64 JSON) or a
// JSON body (version 1) listing what it accepts: scheme, network, amount in base units, asset, payTo. Reinpay reads the
// option for Robinhood Chain (eip155:4663), looks the asset up among the tokens it knows, looks payTo up on your payee
// list, and runs the same dry run as `reinpay check`: the rules, then a mainnet simulation of that transfer.
import { getAddress, isAddress, formatUnits } from "viem";
import { CHAIN_ID, TOKENS, syncTokens } from "./chain.js";
import { findPayee } from "./rules.js";

const NETWORK = `eip155:${CHAIN_ID}`;
const V1_NAMES = { robinhood: CHAIN_ID, "robinhood-chain": CHAIN_ID, "robinhood-mainnet": CHAIN_ID };
// EIP-712 domain of USDG on Robinhood Chain, read from the contract: its DOMAIN_SEPARATOR matches name "Global Dollar",
// version "1", chain 4663, and its TRANSFER_WITH_AUTHORIZATION_TYPEHASH is the EIP-3009 one.
export const USDG_DOMAIN = { name: "Global Dollar", version: "1" };

const header = (headers, name) => (typeof headers?.get === "function" ? headers.get(name) : headers?.[name] ?? headers?.[name.toLowerCase()]) ?? null;
const b64json = (s) => { try { return JSON.parse(Buffer.from(String(s).trim(), "base64").toString("utf8")); } catch { return null; } };

/** Read a 402 answer into { version, resource, error, accepts: [{ scheme, network, chainId, amountRaw, asset, payTo, maxTimeoutSeconds, extra }] }. */
export function readRequired({ headers, body }) {
  let pr = null;
  const h = header(headers, "PAYMENT-REQUIRED");
  if (h) pr = b64json(h);
  if (!pr && body) { try { pr = typeof body === "string" ? JSON.parse(body) : body; } catch { pr = null; } }
  if (!pr || !Array.isArray(pr.accepts)) throw new Error("The service answered 402 but did not say what it accepts (no PAYMENT-REQUIRED header, no x402 body).");
  const version = Number(pr.x402Version) || (h ? 2 : 1);
  const accepts = pr.accepts.map((a) => {
    const net = String(a.network ?? "");
    const chainId = /^eip155:\d+$/.test(net) ? Number(net.split(":")[1]) : V1_NAMES[net.toLowerCase()] ?? null;
    const amt = a.amount ?? a.maxAmountRequired;
    let amountRaw = null; try { amountRaw = /^\d+$/.test(String(amt)) ? BigInt(amt) : null; } catch { amountRaw = null; }
    return { scheme: String(a.scheme ?? ""), network: net, chainId, amountRaw, asset: isAddress(a.asset ?? "") ? getAddress(a.asset) : String(a.asset ?? ""), payTo: isAddress(a.payTo ?? "") ? getAddress(a.payTo) : String(a.payTo ?? ""), maxTimeoutSeconds: a.maxTimeoutSeconds ?? null, extra: a.extra || {} };
  });
  const resource = pr.resource && typeof pr.resource === "object" ? pr.resource : { url: pr.resource ?? pr.accepts[0]?.resource, description: pr.accepts[0]?.description };
  return { version, resource: { url: resource.url || null, description: resource.description || null }, error: pr.error || null, accepts };
}

/**
 * Pick the option Reinpay can judge and say what it means against your config. Pure.
 * Returns { option, token, amount, payee, problem } where problem is set when Reinpay cannot judge it (and says why).
 */
export function judgeOption(req, cfg) {
  const onChain = req.accepts.filter((a) => a.chainId === CHAIN_ID);
  if (!onChain.length) return { problem: `None of its ${req.accepts.length} payment option${req.accepts.length === 1 ? "" : "s"} is on Robinhood Chain (${NETWORK}): ${[...new Set(req.accepts.map((a) => a.network || "?"))].join(", ")}.` };
  const byAddr = Object.values(TOKENS).filter((t) => t.address).reduce((m, t) => ((m[getAddress(t.address)] = t), m), {});
  const known = onChain.filter((a) => isAddress(a.asset) && byAddr[getAddress(a.asset)]);
  if (!known.length) return { option: onChain[0], problem: `It asks for ${onChain[0].asset}, a token Reinpay does not spend. Only USDG, ETH and tokens you added with reinpay token add.` };
  const o = known.find((a) => a.scheme === "exact") || known[0];
  const token = byAddr[getAddress(o.asset)];
  if (o.scheme !== "exact") return { option: o, token: token.symbol, problem: `It uses the "${o.scheme}" scheme. Reinpay reads only "exact" payments (one fixed amount).` };
  if (o.amountRaw === null || o.amountRaw <= 0n) return { option: o, token: token.symbol, problem: "The amount it asks for is not a whole number of base units." };
  if (!isAddress(o.payTo)) return { option: o, token: token.symbol, problem: "It does not say a valid address to pay (payTo)." };
  const amount = formatUnits(o.amountRaw, token.decimals);
  const payee = findPayee(cfg.payees || [], o.payTo);
  const notes = [];
  if (token.symbol === "USDG") {
    const m = o.extra.assetTransferMethod || "eip3009";
    if (m !== "eip3009") notes.push(`It asks for a "${m}" transfer; USDG supports EIP-3009 (transferWithAuthorization).`);
    if (o.extra.name && (o.extra.name !== USDG_DOMAIN.name || String(o.extra.version ?? "") !== USDG_DOMAIN.version)) notes.push(`Its signing domain (${o.extra.name} ${o.extra.version ?? ""}) is not the one the USDG contract uses (${USDG_DOMAIN.name} ${USDG_DOMAIN.version}): a signature for it would be refused.`);
  }
  return { option: o, token: token.symbol, amount, payee: payee ? payee.name : null, payTo: o.payTo, notes };
}

/** Plain lines for the terminal. */
export function x402Lines(r) {
  const L = [];
  if (!r.needsPayment) return [`${r.url} answered ${r.status}: it does not ask for an x402 payment.`];
  L.push(`${r.url} asks to be paid (x402 v${r.version}).${r.description ? ` ${r.description}` : ""}`);
  if (r.problem) { L.push(`  Reinpay cannot judge it: ${r.problem}`); L.push("  Nothing was paid."); return L; }
  L.push(`  ${r.amount} ${r.token} to ${r.payTo}${r.payee ? ` (your payee "${r.payee}")` : " (not on your payee list)"}, on Robinhood Chain.`);
  for (const n of r.notes || []) L.push(`  Note: ${n}`);
  const W = { blocked: "BLOCKED", needs_approval: "WAITS FOR YOU", ready: "READY", sent: "WOULD BE SENT" };
  L.push(`  Your rules: ${W[r.wouldBe] || r.wouldBe} (${r.rule}). ${r.reason}`);
  if (r.simulation?.block) L.push(`  Simulated on mainnet at block ${r.simulation.block}: one transfer out, to ${r.payTo}, of ${r.amount} ${r.token}.`);
  if (!r.payee) L.push(`  To pay this service, first check the address: reinpay payee check ${r.payTo}`);
  L.push("  Nothing was paid or signed. Reinpay does not pay x402 services yet; this tells you what your rules would say.");
  return L;
}

/**
 * Ask the service, read its 402 and judge it. _preview: tests only (the dry run from pay.js).
 * Returns { url, status, needsPayment, version?, description?, problem?, token?, amount?, payTo?, payee?, wouldBe?, rule?, reason?, simulation?, notes? }.
 */
export async function checkX402(url, { memo, fetch: f = globalThis.fetch, _preview, _config } = {}) {
  let u; try { u = new URL(String(url)); } catch { throw new Error(`"${url}" is not a URL.`); }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http and https URLs can be checked.");
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 15000);
  let res; try { res = await f(u.href, { method: "GET", redirect: "follow", signal: ctl.signal, headers: { accept: "application/json" } }); } catch (e) { throw new Error(`Could not reach ${u.host}: ${e.name === "AbortError" ? "no answer in 15 seconds" : e.message}.`); } finally { clearTimeout(timer); }
  const base = { url: u.href, status: res.status };
  if (res.status !== 402) return { ...base, needsPayment: false };
  const text = (await res.text()).slice(0, 200000);
  const req = readRequired({ headers: res.headers, body: text || null });
  const cfg = _config || (await import("./config.js")).loadConfig();
  if (!_config) syncTokens(cfg);
  const j = judgeOption(req, cfg);
  const out = { ...base, needsPayment: true, version: req.version, description: req.resource.description, resource: req.resource.url, ...j, option: undefined, network: j.option?.network };
  if (j.problem) return out;
  if (!j.payee) return { ...out, wouldBe: "blocked", rule: "payee list", reason: `${j.payTo} is not on your payee list. Only you can add payees (reinpay payee add).` };
  const preview = _preview || (await import("./pay.js")).previewPayment;
  const v = await preview({ payee: j.payee, amount: j.amount, token: j.token, memo: String(memo ?? req.resource.description ?? `x402: ${u.host}`).slice(0, 200) });
  return { ...out, wouldBe: v.wouldBe, rule: v.rule, reason: v.reason, simulation: v.simulation };
}
