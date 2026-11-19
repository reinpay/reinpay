#!/usr/bin/env node
// The owner's terminal. Commands that create keys, approve payments or change rules refuse to run without a real terminal,
// so an agent driving a shell cannot use them.
import { readFileSync } from "node:fs";
import { generatePrivateKey } from "viem/accounts";

const [cmd, ...rest] = process.argv.slice(2);
const flags = new Set(rest.filter((a) => a.startsWith("--") && !a.includes("=")));
const opt = (k) => rest.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const pos = rest.filter((a) => !a.startsWith("--"));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const HELP = `reinpay ${pkg.version} - a wallet for AI agents that only spends inside your rules (Robinhood Chain mainnet, chain id 4663)

  reinpay mcp                              Run the MCP server on stdio (your agent host starts this)
  reinpay profiles                         List wallets on this computer (one per agent)
  --profile=<name>                         Use that agent's wallet for any command, e.g. reinpay init --profile=research
  reinpay init [--import]                  Create (or import) the encrypted wallet. Terminal only.
  reinpay address                          Print the wallet address
  reinpay status                           Balances, budgets left today and the rules
  reinpay unlock [--for=12h] | lock        Store (for a while) or remove the passphrase file the server signs with
  reinpay seal                             Check your rules, then seal them with your wallet key
  reinpay rules                            Show the rules
  reinpay rule <name> <token> <amount>     Set daily | weekly | monthly | max | approve-above for a token, e.g. reinpay rule daily USDG 50
                                           (weekly and monthly accept "off"; weeks start on Monday, local time)
  reinpay rule repeat-guard <minutes>      Hold repeats of the same payment for that long (0 turns it off)
  reinpay rule breaker <count> <minutes> | off   Freeze when the agent is blocked that often (default 5 in 10 minutes)
  reinpay rule first-payment <ask|off>     Make the first payment to every payee wait for you
  reinpay grant <token> <amount> --for=2h [--note=...]   Extra budget for a while, on top of the daily budget
  reinpay grant list | clear               Show or remove grants
  reinpay check <payee> <amount> [token]   Dry run: what would happen to this payment now (nothing recorded or signed)
  reinpay freeze [reason]                  Stop every payment now (requests, autosend, approvals)
  reinpay unfreeze                         Start again after checking reinpay receipts. Terminal only.
  reinpay autosend <on|off>                Send payments that are inside every rule without asking (needs unlock)
  reinpay payee add <name> <0xaddress> [--tokens=USDG,ETH] [--note=...] [--until=30d]
  reinpay payee until <name> <30d|12h|off> A payee that expires on its own
  reinpay payee list | remove <name> | off <name> | on <name>
  reinpay payee limit <name> <daily|max> <USDG|ETH> <amount|off>   A payee's own daily budget or max per payment
  reinpay pending                          Payments waiting for you
  reinpay approve <RP-id>                  Check the rules again, simulate again, then sign and send
  reinpay reject <RP-id>                   Refuse a waiting payment
  reinpay receipts [--status=sent] [--json | --csv]
  reinpay verify <RP-id> | --all [--json]  Read sent payments back from the chain and check them against their receipts
  reinpay statement [--days=30] [--out=file.json]   A spending statement signed with your wallet key
  reinpay statement check <file.json>      Check anyone's statement: the signature, then every payment on the chain
  reinpay digest [--days=1] [--dry]        Send a short spending summary to your Telegram or webhook (for a daily schedule)
  reinpay backup [--out=file.json]         Everything needed to move this wallet: key (still encrypted), rules, payees, receipts
  reinpay restore <file.json>              Restore a backup into an empty wallet or profile. Terminal only.
  reinpay doctor [--json]                  Check this computer's setup: Node, RPC, chain, wallet, seal, unlock, gas money, payees, budgets
  reinpay token add <0xaddress> | list | remove <SYMBOL>
                                           Spend another ERC-20 (checked on-chain and on Sourcify first)
  reinpay notify telegram <bot-token> <chat-id> | webhook <https-url> | off | test
                                           Tell you when a payment waits for your approval
  reinpay report [--days=7] [--json | --csv]   What was sent, waiting and blocked, per day, with top payees
  reinpay export                           Show the private key. Terminal only.
  reinpay --version`;

function requireTTY(what) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(`reinpay ${what} must be run by you in an interactive terminal, not by an agent.`);
    process.exit(2);
  }
}

function ask(q, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(q);
    let buf = "";
    stdin.setRawMode?.(true); stdin.resume(); stdin.setEncoding("utf8");
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") { stdin.setRawMode?.(false); stdin.pause(); stdin.off("data", onData); process.stdout.write("\n"); return resolve(buf); }
        if (ch === "\u0003") { process.stdout.write("\n"); process.exit(130); }
        if (ch === "\u007f" || ch === "\b") { if (buf.length) { buf = buf.slice(0, -1); if (!hidden) process.stdout.write("\b \b"); } continue; }
        buf += ch; if (!hidden) process.stdout.write(ch);
      }
    };
    stdin.on("data", onData);
  });
}

const line = (r) => `${r.id}  ${r.status.padEnd(14)} ${String(r.amount).padStart(12)} ${r.token.padEnd(4)}  ${r.payee}${r.memo ? `  "${r.memo}"` : ""}\n        ${r.rule}: ${r.reason}${r.explorer ? `\n        ${r.explorer}` : ""}`;

async function main() {
  // --profile=<name> picks one agent's wallet (each profile has its own key, rules, payees and receipts).
  if (opt("profile")) process.env.REINPAY_PROFILE = opt("profile");
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") return console.log(HELP);
  if (cmd === "--version" || cmd === "-v" || cmd === "version") return console.log(pkg.version);
  if (cmd === "mcp") { const { runServer } = await import("../src/server.js"); return runServer(); }

  if (cmd === "profiles") {
    const { readdirSync, existsSync, readFileSync: rf } = await import("node:fs");
    const { join } = await import("node:path");
    const { ROOT } = await import("../src/config.js");
    const addr = (dir) => { try { return JSON.parse(rf(join(dir, "keystore.json"), "utf8")).address || "?"; } catch { return "no wallet yet"; } };
    const rows = [["default", addr(ROOT())]];
    const pdir = join(ROOT(), "profiles");
    if (existsSync(pdir)) for (const n of readdirSync(pdir).sort()) rows.push([n, addr(join(pdir, n))]);
    return console.log(rows.map(([n, a]) => `${n.padEnd(20)} ${a}`).join("\n") + "\n\nUse one with --profile=<name>, e.g. reinpay mcp --profile=research");
  }
  const K = await import("../src/keystore.js");
  const P = await import("../src/pay.js");
  const C = await import("../src/config.js");

  if (cmd === "init") {
    requireTTY("init");
    if (K.keystoreExists()) return console.log(`A wallet already exists: ${K.walletAddress()}`);
    let pk = generatePrivateKey();
    if (flags.has("--import")) {
      pk = (await ask("Private key (0x..., hidden): ", { hidden: true })).trim();
      if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) { console.error("That is not a 32-byte hex private key."); process.exit(1); }
    }
    const a = await ask("New passphrase (10+ characters, hidden): ", { hidden: true });
    const b = await ask("Repeat passphrase: ", { hidden: true });
    if (a !== b) { console.error("The passphrases differ. Nothing was written."); process.exit(1); }
    const addr = K.writeKeystore(pk, a);
    await reseal(a);
    console.log(`Wallet created: ${addr}\nKeystore: ${C.paths().keystore}\nNext: add a payee (reinpay payee add), check the rules (reinpay rules), then fund the wallet with a small amount.`);
    return;
  }
  if (cmd === "address") return console.log(K.walletAddress() ?? "No wallet yet. Run reinpay init.");
  if (cmd === "unlock") {
    requireTTY("unlock");
    const f = opt("for") ?? "12h", m = /^(\d+)(m|h|d)?$/.exec(f);
    if (!m) throw new Error("Usage: reinpay unlock [--for=30m|2h|1d|0]  (0 keeps it unlocked until reinpay lock)");
    const ms = Number(m[1]) * ({ m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] || "m"]);
    K.unlock(await ask("Passphrase (hidden): ", { hidden: true }), ms);
    return console.log(`Unlocked${ms ? ` until ${new Date(Date.now() + ms).toLocaleString()}` : " until you run reinpay lock"}. The MCP server can now sign payments you approve, and those inside your rules if autosend is on.`);
  }
  if (cmd === "seal") {
    requireTTY("seal");
    console.log(JSON.stringify(P.rulesView(), null, 2));
    if ((await ask("Seal these rules and payees with your wallet key? Type yes: ")).trim().toLowerCase() !== "yes") return console.log("Not sealed.");
    return reseal();
  }
  if (cmd === "freeze") {
    const F = await import("../src/freeze.js");
    const was = F.frozen();
    const f = F.freeze({ by: "owner", reason: pos.join(" ") || "Frozen by the owner." });
    return console.log(was ? `Already frozen since ${was.at} (${was.reason}).` : `Frozen. Every payment request is blocked, autosend stops and approvals are refused.\nCheck reinpay receipts, then run reinpay unfreeze when you are ready.`);
  }
  if (cmd === "unfreeze") {
    requireTTY("unfreeze");
    const F = await import("../src/freeze.js");
    const f = F.frozen();
    if (!f) return console.log("Not frozen.");
    console.log(`Frozen since ${f.at} by ${f.by}: ${f.reason}`);
    if ((await ask("Did you check reinpay receipts? Type yes to unfreeze: ")).trim().toLowerCase() !== "yes") return console.log("Still frozen.");
    F.unfreeze();
    return console.log("Unfrozen. Payments follow your rules again.");
  }
  if (cmd === "lock") { K.lock(); return console.log("Locked. The passphrase file is removed."); }
  if (cmd === "export") { requireTTY("export"); console.log(K.exportKey(await ask("Passphrase (hidden): ", { hidden: true }))); return; }
  if (cmd === "status") { const st = await P.walletStatus(); st.configSeal = await P.sealStatus(); st.unlockedUntil = K.isUnlocked() ? (K.unlockedUntil() ? new Date(K.unlockedUntil()).toISOString() : "until reinpay lock") : null; st.frozen = (await import("../src/freeze.js")).frozen(); return console.log(JSON.stringify(st, null, 2)); }
  if (cmd === "rules") return console.log(JSON.stringify(P.rulesView(), null, 2));

  if (cmd === "rule") {
    requireTTY("rule");
    const cfg = C.loadConfig();
    const [name, a1, a2] = pos;
    if (name === "first-payment") {
      if (!["ask", "off"].includes(String(a1))) throw new Error("Usage: reinpay rule first-payment <ask|off>");
      if (a1 === "ask") cfg.rules.firstPayment = "ask"; else delete cfg.rules.firstPayment;
    } else if (name === "breaker") {
      if (String(a1).toLowerCase() === "off") cfg.rules.breaker = "off";
      else {
        const n = Number(a1), m = Number(a2);
        if (!(Number.isInteger(n) && n >= 1 && n <= 100 && Number.isInteger(m) && m >= 1 && m <= 1440)) throw new Error("Usage: reinpay rule breaker <count 1-100> <minutes 1-1440> | off");
        cfg.rules.breaker = { count: n, minutes: m };
      }
    } else if (name === "repeat-guard") {
      const m = Number(a1); if (!(m >= 0 && m <= 1440)) throw new Error("Minutes between 0 and 1440.");
      cfg.rules.repeatGuardMinutes = m;
    } else {
      const key = { daily: "daily", weekly: "weekly", monthly: "monthly", max: "maxPerPayment", "approve-above": "approveAbove" }[name];
      const tok = String(a1 || "").toUpperCase();
      const off = ["weekly", "monthly"].includes(name) && String(a2).toLowerCase() === "off";
      const { syncTokens } = await import("../src/chain.js");
      const known = Object.keys(syncTokens(cfg));
      if (!key || !known.includes(tok) || (!off && !/^\d+(\.\d+)?$/.test(String(a2 || "")))) throw new Error(`Usage: reinpay rule <daily|weekly|monthly|max|approve-above> <${known.join("|")}> <amount> (weekly and monthly also take off)`);
      if (off) { cfg.rules[key] = { ...(cfg.rules[key] || {}) }; delete cfg.rules[key][tok]; }
      else cfg.rules[key] = { ...(cfg.rules[key] || {}), [tok]: a2 };
    }
    C.saveConfig(cfg);
    return console.log(JSON.stringify(P.rulesView(), null, 2));
  }
  if (cmd === "autosend") {
    requireTTY("autosend");
    const on = pos[0] === "on"; if (!["on", "off"].includes(pos[0])) throw new Error("Usage: reinpay autosend <on|off>");
    const cfg = C.loadConfig(); cfg.rules.autoSend = on; C.saveConfig(cfg);
    return console.log(on ? `autosend is on. Payments inside every rule are sent without asking${K.isUnlocked() ? "." : ", once you run reinpay unlock."}` : "autosend is off. Every payment waits for reinpay approve.");
  }
  if (cmd === "payee") {
    const [sub, name, address] = pos;
    if (sub === "list" || !sub) return console.log(JSON.stringify(C.loadConfig().payees, null, 2));
    requireTTY("payee " + sub);
    if (sub === "add") {
      const tokens = opt("tokens") ? opt("tokens").toUpperCase().split(",") : undefined;
      let p;
      const untilMs = opt("until") ? (await import("../src/rules.js")).parseDuration(opt("until")) : null;
      try { p = await P.addPayee({ name, address, tokens, note: opt("note"), untilMs }); }
      catch (e) {
        if (e.code !== "LOOKALIKE") throw e;
        console.log(`\nCareful: ${e.message}\n\n  new:      ${address}\n  existing: ${e.like.address}  (${e.like.name})\n`);
        const typed = (await ask("If you checked it and it is right, type the new address again in full: ")).trim();
        if (typed.toLowerCase() !== String(address).toLowerCase()) { console.log("Not added. Nothing changed."); process.exit(1); }
        p = await P.addPayee({ name, address, tokens, note: opt("note"), allowLookalike: true, untilMs });
      }
      return console.log(`Added ${p.name} ${p.address}${p.expiresAt ? `, until ${p.expiresAt}` : ""}${p.isContract ? " (a contract, not a personal wallet: make sure it can receive tokens)" : ""}.`);
    }
    if (sub === "remove") return console.log(`Removed ${P.removePayee(name).name}.`);
    if (sub === "until") {
      const ms = (await import("../src/rules.js")).parseDuration(pos[2]);
      const p = P.setPayee(name, { expiresAt: ms ? new Date(Date.now() + ms).toISOString() : undefined });
      return console.log(ms ? `${p.name} can be paid until ${p.expiresAt}.` : `${p.name} no longer expires.`);
    }
    if (sub === "off" || sub === "on") return console.log(`${P.setPayee(name, { disabled: sub === "off" }).name} is ${sub}.`);
    if (sub === "limit") {
      const [, , kind, tok, amount] = pos;
      const p = P.setPayeeLimit(name, kind, tok, amount);
      return console.log(`${p.name}: daily ${JSON.stringify(p.daily || {})}, max per payment ${JSON.stringify(p.maxPerPayment || {})}.`);
    }
    throw new Error("Usage: reinpay payee <add|list|remove|off|on|limit|until>");
  }
  if (cmd === "pending") {
    const list = [...P.listReceipts({ status: "needs_approval", limit: 200 }), ...P.listReceipts({ status: "ready", limit: 200 })];
    return console.log(list.length ? list.map(line).join("\n") : "Nothing is waiting for you.");
  }
  if (cmd === "approve") {
    requireTTY("approve");
    const id = pos[0]; if (!id) throw new Error("Usage: reinpay approve <RP-id>");
    const { getReceipt, view } = await import("../src/receipts.js");
    const r = getReceipt(id); if (!r) throw new Error(`No receipt ${id}.`);
    console.log(line(view(r)));
    if ((await ask("Approve and send this payment? Type yes: ")).trim().toLowerCase() !== "yes") return console.log("Not approved. Nothing was sent.");
    const pass = K.isUnlocked() ? undefined : await ask("Passphrase (hidden): ", { hidden: true });
    return console.log(line(await P.approve(id, { passphrase: pass })));
  }
  if (cmd === "reject") { requireTTY("reject"); return console.log(line(P.reject(pos[0]))); }
  if (cmd === "notify") {
    requireTTY("notify");
    const { parseNotify, notifyOwner } = await import("../src/notify.js");
    const cfg = C.loadConfig();
    if (pos[0] === "test") {
      if (!cfg.notify) throw new Error("Notifications are off. Set them up first: reinpay notify telegram <bot-token> <chat-id>");
      const n = await notifyOwner({ id: "RP-TEST", amount: "1", token: "USDG", payee: "Test", memo: "test message", rule: "test", reason: "This is a test from reinpay notify test.", status: "needs_approval" }, { cfg });
      return console.log(n.ok ? `Sent (${n.detail}).` : `Not sent: ${n.detail}`);
    }
    const n = parseNotify(pos[0], pos[1], pos[2]);
    if (n) cfg.notify = n; else delete cfg.notify;
    C.saveConfig(cfg);
    return console.log(n ? `Notifications on (${n.type}). Run reinpay notify test to check.` : "Notifications off.");
  }
  if (cmd === "report") {
    const { spendingReport, reportText } = await import("../src/report.js");
    const { allReceipts } = await import("../src/receipts.js");
    (await import("../src/chain.js")).syncTokens();
    const rep = spendingReport(allReceipts(), { days: opt("days") || 7 });
    if (flags.has("--csv")) return process.stdout.write((await import("../src/csv.js")).reportCSV(rep));
    return console.log(flags.has("--json") ? JSON.stringify(rep, null, 2) : reportText(rep));
  }
  if (cmd === "token") {
    const [sub, arg] = pos;
    const { syncTokens } = await import("../src/chain.js");
    if (sub === "list" || !sub) return console.log(JSON.stringify(Object.values(syncTokens()), null, 2));
    requireTTY("token " + sub);
    if (sub === "add") {
      const t = await P.addToken(arg);
      return console.log(`Added ${t.symbol} (${t.name}) at ${t.address}, ${t.decimals} decimals, Sourcify ${t.sourcify}.\nIt cannot be spent until you set a daily budget: reinpay rule daily ${t.symbol} <amount>`);
    }
    if (sub === "remove") return console.log(`Removed ${P.removeToken(arg)}. Its receipts stay.`);
    throw new Error("Usage: reinpay token <add <0xaddress>|list|remove <SYMBOL>>");
  }
  if (cmd === "verify") {
    const { verifyReceipt } = await import("../src/verify.js");
    const { allReceipts, getReceipt } = await import("../src/receipts.js");
    const list = flags.has("--all") ? allReceipts().filter((r) => r.txHash) : [getReceipt(pos[0] || "")];
    if (!flags.has("--all") && !list[0]) throw new Error(pos[0] ? `No receipt ${pos[0]}.` : "Usage: reinpay verify <RP-id> | --all");
    const res = [];
    for (const r of list) res.push(await verifyReceipt(r));
    if (flags.has("--json")) console.log(JSON.stringify(res, null, 2));
    else if (!res.length) console.log("No sent payments to check yet.");
    else for (const v of res) console.log(v.reason ? `- ${v.id}: ${v.reason}` : `${v.ok ? "✓" : "✕"} ${v.id} ${v.ok ? "matches the chain" : "does NOT match the chain"}  ${v.explorer}\n${v.checks.map((c) => `    ${c.ok ? "✓" : "✕"} ${c.name}: ${c.detail}`).join("\n")}`);
    if (res.some((v) => v.checks && !v.ok)) process.exitCode = 1;
    return;
  }
  if (cmd === "grant") {
    const [sub] = pos;
    const cfg = C.loadConfig();
    const now = Date.now();
    if (sub === "list" || !sub) return console.log(JSON.stringify((cfg.rules.grants || []).map((g) => ({ ...g, active: Date.parse(g.until) > now })), null, 2));
    requireTTY("grant");
    if (sub === "clear") { delete cfg.rules.grants; C.saveConfig(cfg); return console.log("All grants removed."); }
    const tok = String(sub).toUpperCase(), amount = pos[1];
    const { syncTokens } = await import("../src/chain.js");
    if (!Object.keys(syncTokens(cfg)).includes(tok) || !/^\d+(\.\d+)?$/.test(String(amount || ""))) throw new Error("Usage: reinpay grant <token> <amount> --for=2h [--note=...]");
    const ms = (await import("../src/rules.js")).parseDuration(opt("for") || "");
    if (!ms || ms > 30 * 86_400_000) throw new Error("--for is required, up to 30d (e.g. --for=2h).");
    const g = { token: tok, amount: String(amount), until: new Date(now + ms).toISOString(), ...(opt("note") ? { note: opt("note").slice(0, 100) } : {}) };
    cfg.rules.grants = [...(cfg.rules.grants || []).filter((x) => Date.parse(x.until) > now), g];
    C.saveConfig(cfg);
    return console.log(`Granted ${g.amount} ${tok} on top of the daily budget until ${g.until}.`);
  }
  if (cmd === "check") {
    const [payee, amount, token] = pos;
    if (!payee || !amount) throw new Error("Usage: reinpay check <payee> <amount> [token]");
    const v = await P.previewPayment({ payee, amount, token: token || "USDG" });
    return console.log(flags.has("--json") ? JSON.stringify(v, null, 2) : `Dry run: ${v.amount} ${v.token} to ${v.payee} would be ${v.wouldBe.toUpperCase()} (${v.rule}). ${v.reason}${v.simulation ? `\nSimulated on mainnet at block ${v.simulation.block}${v.simulation.estimatedFeeEth ? `, fee about ${v.simulation.estimatedFeeEth} ETH` : ""}.` : ""}\nNothing was recorded or signed.`);
  }
  if (cmd === "backup") {
    const { makeBackup } = await import("../src/backup.js");
    const { writeFileSync: wf, existsSync: ex } = await import("node:fs");
    const b = makeBackup();
    const out = opt("out") || `reinpay-backup-${b.address.slice(2, 8).toLowerCase()}-${b.createdAt.slice(0, 10)}.json`;
    if (ex(out) && !flags.has("--force")) throw new Error(`${out} already exists. Use --out=<file> or --force.`);
    wf(out, JSON.stringify(b, null, 1) + "\n", { mode: 0o600 });
    return console.log(`Wrote ${out} for ${b.address}. The key inside is still encrypted with your passphrase; keep the file somewhere safe anyway, and do not share it.`);
  }
  if (cmd === "restore") {
    requireTTY("restore");
    const { restoreBackup } = await import("../src/backup.js");
    const { readFileSync: rf } = await import("node:fs");
    if (!pos[0]) throw new Error("Usage: reinpay restore <file.json>");
    let b; try { b = JSON.parse(rf(pos[0], "utf8")); } catch { throw new Error(`${pos[0]} is not a readable JSON file.`); }
    const r = await restoreBackup(b);
    return console.log(`Restored ${r.address} with ${r.receipts} receipts${r.frozen ? " (still frozen)" : ""}. Config seal: ${r.seal.ok ? "ok" : r.seal.reason}.\nYour passphrase is the same as before. Run reinpay doctor to check the setup.`);
  }
  if (cmd === "statement") {
    const S = await import("../src/statement.js");
    const { readFileSync: rf, writeFileSync: wf, existsSync: ex } = await import("node:fs");
    if (pos[0] === "check") {
      if (!pos[1]) throw new Error("Usage: reinpay statement check <file.json>");
      let st; try { st = JSON.parse(rf(pos[1], "utf8")); } catch { throw new Error(`${pos[1]} is not a readable JSON file.`); }
      const res = await S.checkStatement(st);
      console.log(flags.has("--json") ? JSON.stringify(res, null, 2) : S.statementCheckText(st, res));
      if (!res.ok) process.exitCode = 1;
      return;
    }
    const { allReceipts } = await import("../src/receipts.js");
    const st = S.buildStatement(allReceipts(), { wallet: P.requireWallet(), days: opt("days") || 30 });
    if (!K.isUnlocked()) requireTTY("statement");
    const signed = await S.signStatement(st, K.loadAccount(K.isUnlocked() ? undefined : await ask("Passphrase to sign the statement (hidden): ", { hidden: true })));
    const out = opt("out") || `reinpay-statement-${st.from}-to-${st.to}.json`;
    if (ex(out) && !flags.has("--force")) throw new Error(`${out} already exists. Use --out=<file> or --force.`);
    wf(out, JSON.stringify(signed, null, 2) + "\n");
    return console.log(`Wrote ${out}: ${st.count} sent payment${st.count === 1 ? "" : "s"} from ${st.from} to ${st.to}, totals ${JSON.stringify(st.totals)}, signed by ${signed.signature.by}.\nAnyone can check it with: reinpay statement check ${out}`);
  }
  if (cmd === "digest") {
    const { currentDigest } = await import("../src/digest.js");
    const { allReceipts } = await import("../src/receipts.js");
    (await import("../src/chain.js")).syncTokens();
    const text = currentDigest(allReceipts(), { days: opt("days") || 1 });
    if (flags.has("--dry")) return console.log(text);
    const cfg = C.loadConfig();
    if (!cfg.notify) throw new Error("Notifications are off, so there is nowhere to send the digest. Set them up with reinpay notify, or use --dry to print it.");
    const { notifyOwner } = await import("../src/notify.js");
    const n = await notifyOwner({ id: "DIGEST", status: "digest" }, { cfg, text, event: "digest" });
    console.log(n.ok ? `Digest sent (${n.detail}).` : `Digest not sent: ${n.detail}`);
    if (!n.ok) process.exitCode = 1;
    return;
  }
  if (cmd === "doctor") {
    const { doctor, doctorText } = await import("../src/doctor.js");
    const checks = await doctor();
    console.log(flags.has("--json") ? JSON.stringify(checks, null, 2) : doctorText(checks));
    if (checks.some((c) => c.level === "fail")) process.exitCode = 1;
    return;
  }
  if (cmd === "receipts") {
    const list = P.listReceipts({ status: opt("status"), limit: 200 });
    if (flags.has("--csv")) {
      const { toCSV, RECEIPT_COLS } = await import("../src/csv.js");
      const { allReceipts, view } = await import("../src/receipts.js");
      const all = allReceipts().filter((r) => !opt("status") || r.status === opt("status")).map(view); // every receipt, oldest first
      return process.stdout.write(toCSV(all, RECEIPT_COLS));
    }
    return console.log(flags.has("--json") ? JSON.stringify(list, null, 2) : list.length ? list.map(line).join("\n") : "No receipts yet.");
  }
  console.error(`Unknown command "${cmd}".\n\n${HELP}`);
  process.exit(1);
}

// Commands that change rules, payees, tokens or notifications seal the config with the wallet key afterwards.
const MUTATING = ["rule", "autosend"].includes(cmd) || (cmd === "grant" && pos[0] && pos[0] !== "list") || (cmd === "notify" && pos[0] !== "test") || (cmd === "payee" && ["add", "remove", "off", "on", "limit", "until"].includes(pos[0])) || (cmd === "token" && ["add", "remove"].includes(pos[0]));
async function reseal(passphrase) {
  const K = await import("../src/keystore.js"), C = await import("../src/config.js"), { sealConfig } = await import("../src/seal.js");
  const pass = passphrase ?? (K.isUnlocked() ? undefined : await ask("Passphrase to seal your rules (hidden): ", { hidden: true }));
  const sealed = await sealConfig(C.loadConfig(), K.loadAccount(pass));
  C.saveConfig(sealed);
  console.log(`Rules sealed with your wallet key (${sealed.seal.at}).`);
}
main().then(() => (MUTATING ? reseal() : null)).catch((e) => { console.error(e?.shortMessage || e?.message || e); process.exit(1); });
