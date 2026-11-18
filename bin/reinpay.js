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
  reinpay init [--import]                  Create (or import) the encrypted wallet. Terminal only.
  reinpay address                          Print the wallet address
  reinpay status                           Balances, budgets left today and the rules
  reinpay unlock | lock                    Store or remove the passphrase file the server signs with
  reinpay rules                            Show the rules
  reinpay rule <name> <token> <amount>     Set daily | max | approve-above for USDG or ETH, e.g. reinpay rule daily USDG 50
  reinpay rule repeat-guard <minutes>      Hold repeats of the same payment for that long (0 turns it off)
  reinpay autosend <on|off>                Send payments that are inside every rule without asking (needs unlock)
  reinpay payee add <name> <0xaddress> [--tokens=USDG,ETH] [--note=...]
  reinpay payee list | remove <name> | off <name> | on <name>
  reinpay pending                          Payments waiting for you
  reinpay approve <RP-id>                  Check the rules again, simulate again, then sign and send
  reinpay reject <RP-id>                   Refuse a waiting payment
  reinpay receipts [--status=sent] [--json]
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
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") return console.log(HELP);
  if (cmd === "--version" || cmd === "-v" || cmd === "version") return console.log(pkg.version);
  if (cmd === "mcp") { const { runServer } = await import("../src/server.js"); return runServer(); }

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
    console.log(`Wallet created: ${addr}\nKeystore: ${C.paths().keystore}\nNext: add a payee (reinpay payee add), check the rules (reinpay rules), then fund the wallet with a small amount.`);
    return;
  }
  if (cmd === "address") return console.log(K.walletAddress() ?? "No wallet yet. Run reinpay init.");
  if (cmd === "unlock") { requireTTY("unlock"); K.unlock(await ask("Passphrase (hidden): ", { hidden: true })); return console.log("Unlocked. The MCP server can now sign payments that are inside your rules (if autosend is on) or that you approve."); }
  if (cmd === "lock") { K.lock(); return console.log("Locked. The passphrase file is removed."); }
  if (cmd === "export") { requireTTY("export"); console.log(K.exportKey(await ask("Passphrase (hidden): ", { hidden: true }))); return; }
  if (cmd === "status") return console.log(JSON.stringify(await P.walletStatus(), null, 2));
  if (cmd === "rules") return console.log(JSON.stringify(P.rulesView(), null, 2));

  if (cmd === "rule") {
    requireTTY("rule");
    const cfg = C.loadConfig();
    const [name, a1, a2] = pos;
    if (name === "repeat-guard") {
      const m = Number(a1); if (!(m >= 0 && m <= 1440)) throw new Error("Minutes between 0 and 1440.");
      cfg.rules.repeatGuardMinutes = m;
    } else {
      const key = { daily: "daily", max: "maxPerPayment", "approve-above": "approveAbove" }[name];
      const tok = String(a1 || "").toUpperCase();
      if (!key || !["USDG", "ETH"].includes(tok) || !/^\d+(\.\d+)?$/.test(String(a2 || ""))) throw new Error("Usage: reinpay rule <daily|max|approve-above> <USDG|ETH> <amount>");
      cfg.rules[key] = { ...(cfg.rules[key] || {}), [tok]: a2 };
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
      const p = await P.addPayee({ name, address, tokens, note: opt("note") });
      return console.log(`Added ${p.name} ${p.address}${p.isContract ? " (a contract, not a personal wallet: make sure it can receive tokens)" : ""}.`);
    }
    if (sub === "remove") return console.log(`Removed ${P.removePayee(name).name}.`);
    if (sub === "off" || sub === "on") return console.log(`${P.setPayee(name, { disabled: sub === "off" }).name} is ${sub}.`);
    throw new Error("Usage: reinpay payee <add|list|remove|off|on>");
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
  if (cmd === "receipts") {
    const list = P.listReceipts({ status: opt("status"), limit: 200 });
    return console.log(flags.has("--json") ? JSON.stringify(list, null, 2) : list.length ? list.map(line).join("\n") : "No receipts yet.");
  }
  console.error(`Unknown command "${cmd}".\n\n${HELP}`);
  process.exit(1);
}

main().catch((e) => { console.error(e?.shortMessage || e?.message || e); process.exit(1); });
