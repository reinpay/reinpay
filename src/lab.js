// reinpay lab run: scams against an AI agent wallet, run for real. Each attack is a set of payment requests an agent
// could be talked into. Each rule set is a throwaway wallet (in a temporary folder, with a pretend 1 ETH that exists only
// inside the simulation and the balance read). Every request goes through the real rules and, when they let it through,
// a real eth_simulateV1 call on Robinhood Chain mainnet. Nothing is ever signed or sent.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getAddress, parseEther } from "viem";
import { ROWS, attacks, verdict, partOf } from "./labcore.js";
export { ROWS, attacks, verdict, partOf };

import { WEATHER, GPU, USDG } from "./labcore.js";

async function oneCell(row, attack, { P, C, K, S, CH, RC, sealConfig }) {
  const dir = mkdtempSync(join(tmpdir(), "reinpay-lab-"));
  process.env.REINPAY_HOME = dir;
  const c = CH.publicClient(), realBalance = c.getBalance, prev = S._getTestOverrides();
  try {
    const pk = generatePrivateKey(), acct = privateKeyToAccount(pk), me = getAddress(acct.address);
    K.writeKeystore(pk, "lab-" + Math.random().toString(36).slice(2, 12));
    c.getBalance = async (a) => (getAddress(a.address) === me ? parseEther("1") : realBalance.call(c, a));
    S._setTestOverrides((from) => (getAddress(from) === me ? { [me]: { balance: "0xde0b6b3a7640000" } } : prev ? prev(from) : undefined));
    const now = new Date().toISOString(), rules = Object.fromEntries(Object.entries({ ...C.DEFAULT_CONFIG.rules, ...row.rules }).filter(([, v]) => v !== undefined));
    const payees = [{ name: "Weather API", address: getAddress(WEATHER), isContract: false, addedAt: now }, { name: "GPU credits", address: getAddress(GPU), isContract: false, addedAt: now }, { name: "USDG payouts", address: getAddress(USDG), addedAt: now }];
    C.saveConfig(await sealConfig({ ...C.DEFAULT_CONFIG, rules, payees }, acct));
    const out = [];
    for (const q of attack.requests) {
      let r = null;
      for (let i = 1; i <= 4 && !r; i++) {
        try { r = await P.requestPayment({ payee: q.payee, amount: q.amount, token: "ETH", memo: q.memo }, { by: "lab" }); }
        catch (e) { if (i === 4) { out.push({ void: true, error: String(e?.shortMessage || e?.message).slice(0, 120) }); } else await new Promise((res) => setTimeout(res, 2000 * i)); }
      }
      if (r) out.push({ status: r.status, rule: r.rule, reason: r.reason, ...(r.simulation?.block ? { block: r.simulation.block } : {}) });
    }
    return out;
  } finally {
    c.getBalance = realBalance; S._setTestOverrides(prev);
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Runs every attack against every rule set. Returns the run, ready to be written as JSON. */
export async function runLab({ onCell = () => {} } = {}) {
  const saved = { home: process.env.REINPAY_HOME, profile: process.env.REINPAY_PROFILE };
  delete process.env.REINPAY_PROFILE;
  const M = { P: await import("./pay.js"), C: await import("./config.js"), K: await import("./keystore.js"), S: await import("./simulate.js"), CH: await import("./chain.js"), RC: await import("./receipts.js"), sealConfig: (await import("./seal.js")).sealConfig };
  try {
    const blk = await M.CH.publicClient().getBlock();
    const v = parseInt(blk.hash.slice(2, 10), 16) / 0xffffffff;
    const A = attacks(v), cells = [];
    for (const [rid, row] of Object.entries(ROWS)) for (const a of A) {
      const results = await oneCell(row, a, M), cell = { row: rid, attack: a.id, ...verdict(a, results), results };
      cells.push(cell); onCell(cell, row, a);
    }
    const count = (o) => cells.filter((x) => x.outcome === o).length;
    const run = { kind: "reinpay-lab-run", version: 1, at: new Date().toISOString(), block: blk.number.toString(), blockHash: blk.hash, draw: v,
      rows: Object.entries(ROWS).map(([id, r]) => ({ id, label: r.label, about: r.about, rules: r.rules })),
      attacks: A.map(({ id, label, target, story, requests, breachAt, rule }) => ({ id, label, target, story, requests, breachAt: breachAt || 1, ...(rule ? { rule } : {}) })),
      cells, totals: { paid: count("paid"), held: count("held"), blocked: count("blocked"), void: count("void") },
      note: "Throwaway wallets with a pretend 1 ETH that exists only inside the simulation. Real Reinpay rules, real eth_simulateV1 calls on Robinhood Chain mainnet. Nothing was signed or sent." };
    run.sha256 = createHash("sha256").update(JSON.stringify({ ...run, sha256: undefined })).digest("hex");
    return run;
  } finally {
    if (saved.home === undefined) delete process.env.REINPAY_HOME; else process.env.REINPAY_HOME = saved.home;
    if (saved.profile !== undefined) process.env.REINPAY_PROFILE = saved.profile;
  }
}
