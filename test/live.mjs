// Live test on Robinhood Chain mainnet (chain id 4663). Reads and eth_simulateV1 only: nothing is ever signed or sent.
// A throwaway wallet gets a pretend ETH balance inside the simulation; public, unrelated addresses are used for transfers.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePrivateKey } from "viem/accounts";
import { parseEther, parseAbiItem, erc20Abi, getAddress } from "viem";

process.env.REINPAY_HOME = mkdtempSync(join(tmpdir(), "reinpay-live-"));
const home = process.env.REINPAY_HOME;
const K = await import("../src/keystore.js");
const me = K.writeKeystore(generatePrivateKey(), "throwaway-test-passphrase");
const { publicClient, TOKENS, CHAIN_ID } = await import("../src/chain.js");
const C = await import("../src/config.js");
const P = await import("../src/pay.js");
const S = await import("../src/simulate.js");

let pass = 0, fail = 0;
const check = (label, cond, info = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"} ${label}${info ? ` (${info})` : ""}`); };
const c = publicClient();
const DEAD = getAddress("0x000000000000000000000000000000000000dEaD");
const OTHER = getAddress("0x00000000000000000000000000000000DeaDBeef");

// ---- chain and token facts ----
check(`chain id is ${CHAIN_ID}`, (await c.getChainId()) === CHAIN_ID);
const U = TOKENS.USDG.address;
const [sym, dec, code] = await Promise.all([c.readContract({ address: U, abi: erc20Abi, functionName: "symbol" }), c.readContract({ address: U, abi: erc20Abi, functionName: "decimals" }), c.getCode({ address: U })]);
check(`USDG ${U}: symbol ${sym}, ${dec} decimals, has code`, sym === "USDG" && dec === 6 && code && code.length > 2);

// ---- simulations from a real public USDG holder (found from recent Transfer logs) ----
const head = await c.getBlockNumber();
const logs = await c.getLogs({ address: U, event: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)"), fromBlock: head - 4_000n, toBlock: head });
let holder = null, hbal = 0n;
for (const to of [...new Set(logs.map((l) => l.args.to))].slice(-60)) {
  const cd = await c.getCode({ address: to });
  if (cd && cd !== "0x") continue;
  const b = await c.readContract({ address: U, abi: erc20Abi, functionName: "balanceOf", args: [to] });
  if (b >= 2_000_000n) { holder = to; hbal = b; break; }
}
check(`found a public wallet holding at least 2 USDG (${holder})`, !!holder);
const one = 1_000_000n;
const s1 = await S.simulate(holder, P.buildTx("USDG", DEAD, one));
check("simulated 1 USDG transfer: exactly one outflow, to the payee, of 1 USDG", S.mismatch(s1, { tokenAddress: U, to: DEAD, amount: one }) === null, `block ${s1.block}, gas ${s1.gasUsed}`);
check("the same simulation refuses a different payee", S.mismatch(s1, { tokenAddress: U, to: OTHER, amount: one }) !== null);
check("the same simulation refuses a different amount", S.mismatch(s1, { tokenAddress: U, to: DEAD, amount: one + 1n }) !== null);
check("the same simulation refuses a different token (ETH)", S.mismatch(s1, { tokenAddress: null, to: DEAD, amount: one }) !== null);
const sTooMuch = await S.simulate(holder, P.buildTx("USDG", DEAD, hbal + 1n));
check("a transfer above the holder's balance fails in simulation", !sTooMuch.ok && /fail/.test(S.mismatch(sTooMuch, { tokenAddress: U, to: DEAD, amount: hbal + 1n })));

// ---- the payment flow with a throwaway wallet (pretend 1 ETH, only inside the simulation and the balance read) ----
const realGetBalance = c.getBalance.bind(c);
c.getBalance = async (a) => (getAddress(a.address) === getAddress(me) ? parseEther("1") : realGetBalance(a));
S._setTestOverrides((from) => (getAddress(from) === getAddress(me) ? { [me]: { balance: "0xde0b6b3a7640000" } } : undefined));
await P.addPayee({ name: "Test payee", address: DEAD, note: "public burn address" });
await P.addPayee({ name: "USDG only", address: OTHER, tokens: ["USDG"] });
const rq = (payee, amount, token = "ETH", memo = "live test") => P.requestPayment({ payee, amount, token, memo }, { by: "test" });

const r1 = await rq("Test payee", "0.0005");
check("0.0005 ETH inside the rules: simulated on mainnet, then waits because autosend is off", r1.status === "ready" && r1.simulation?.ok && /autoSend is off/.test(r1.reason), r1.simulation && `block ${r1.simulation.block}, fee ~${r1.simulation.estimatedFeeEth} ETH`);
check("the receipt the agent sees has no transaction data", r1.tx === undefined);
const r2 = await rq("Test payee", "0.0005");
check("the same payment again is held by the repeat guard", r2.status === "needs_approval" && r2.rule === "repeat guard");
const r3 = await rq("Test payee", "0.0015");
check("0.0015 ETH is above the approval line (0.001) and waits", r3.status === "needs_approval" && r3.rule === "approval line");
const r4 = await rq("Test payee", "0.0025");
check("0.0025 ETH is above the max per payment (0.002) and is blocked", r4.status === "blocked" && r4.rule === "max per payment");
const r5 = await rq("Test payee", "0.0019");
const r6 = await rq("Test payee", "0.001");
check(`waiting payments count against the daily budget (0.005): 0.001 more is blocked (${r6.reason})`, r5.status === "needs_approval" && r6.status === "blocked" && r6.rule === "daily budget");
const rj = P.reject(r5.id);
const r7 = await rq("Test payee", "0.0009");
check("rejecting a waiting payment frees its budget", rj.status === "rejected" && r7.status === "ready");
const r8 = await rq("Somebody", "0.0001");
check("an unlisted payee is blocked", r8.status === "blocked" && r8.rule === "payee list");
const r9 = await rq("USDG only", "0.0001");
check("a USDG-only payee cannot be paid in ETH", r9.status === "blocked" && r9.rule === "payee tokens");
const r10 = await rq("Test payee", "1", "USDG");
check("a USDG payment from a wallet without USDG is blocked before signing", r10.status === "blocked" && /holds 0 USDG/.test(r10.reason));
// Approval re-checks the rules: shrink the daily budget, then approving refuses before anything is signed.
const cfg = C.loadConfig(); cfg.rules.daily.ETH = "0.0001"; C.saveConfig(cfg);
const ap = await P.approve(r1.id, { passphrase: "throwaway-test-passphrase" });
check("approve checks the budget again and refuses before signing", ap.status === "blocked" && ap.rule === "daily budget" && !ap.txHash);
cfg.rules.daily.ETH = "0.005"; cfg.rules.autoSend = true; C.saveConfig(cfg);
const r11 = await rq("Test payee", "0.0001");
check("autosend on but the wallet locked: nothing is sent, the payment waits", r11.status === "ready" && /locked/.test(r11.reason) && !r11.txHash);
cfg.rules.autoSend = false; C.saveConfig(cfg);
// 0.2.0: two requests at the same moment cannot both spend the same budget left
{
  const before = P.rulesView().tokens.ETH.leftToday;
  const [ca, cb] = await Promise.all([rq("Test payee", "0.0012", "ETH", "race a"), rq("Test payee", "0.0011", "ETH", "race b")]);
  const blocked = [ca, cb].filter((x) => x.status === "blocked" && x.rule === "daily budget");
  check(`two requests at once with ${before} left: one waits, the other is blocked by the daily budget`, blocked.length === 1 && [ca, cb].some((x) => x.status === "needs_approval"), `${ca.status}/${cb.status}`);
  P.setPayeeLimit("Test payee", "daily", "ETH", "0.004");
  const pv = P.rulesView().payees.find((x) => x.name === "Test payee");
  check(`a payee's own daily budget shows in the agent's rules (${JSON.stringify(pv.limits?.ETH)})`, pv.limits?.ETH?.dailyBudget === "0.004 ETH");
  const pd = await rq("Test payee", "0.0001", "ETH", "payee cap");
  check("a request over the payee's own daily budget is blocked by that rule", pd.status === "blocked" && pd.rule === "payee daily budget", pd.reason);
  P.setPayeeLimit("Test payee", "daily", "ETH", "off");
  check("payee limit off clears it", !P.rulesView().payees.find((x) => x.name === "Test payee").limits);
  const { spendingReport } = await import("../src/report.js");
  const { allReceipts } = await import("../src/receipts.js");
  const rep = spendingReport(allReceipts(), { days: 1 });
  check(`the report counts today's requests (ETH: ${rep.totals.ETH.waitingCount} waiting, ${rep.totals.ETH.blockedCount} blocked)`, rep.totals.ETH.waitingCount >= 3 && rep.totals.ETH.blockedCount >= 4 && rep.totals.ETH.sentCount === 0);
}
// 0.3.0: token contracts are never payees, weekly and monthly budgets, owner notifications
{
  const REINPAY_TOKEN = "0x17c4735E9da7F1eeB76d1cC17C2f196F38DE64b3";
  let e1 = ""; try { await P.addPayee({ name: "Oops token", address: REINPAY_TOKEN }); } catch (e) { e1 = e.message; }
  check(`adding a token's own contract as a payee is refused (${e1.slice(0, 70)}...)`, /contract of REINPAY/.test(e1));
  const PONS_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
  const pf = await P.addPayee({ name: "A contract that is not a token", address: PONS_FACTORY });
  check("a contract that is not a token can still be a payee (flagged as a contract)", pf.isContract === true);
  P.removePayee("A contract that is not a token");
  const cfg2 = C.loadConfig(); cfg2.payees.push({ name: "Hand edited", address: REINPAY_TOKEN }); C.saveConfig(cfg2);
  const ht = await rq("Hand edited", "0.0001");
  check("a token contract slipped into config.json by hand is blocked at payment time", ht.status === "blocked" && ht.rule === "token contract", ht.reason);
  P.removePayee("Hand edited");
  const cfg3 = C.loadConfig(); cfg3.rules.weekly = { ETH: "0.0001" }; C.saveConfig(cfg3);
  const wk = P.rulesView().tokens.ETH.weeklyBudget;
  check(`get_rules shows the weekly budget and what is left (${JSON.stringify(wk)})`, wk?.budget === "0.0001 ETH" && wk.left === "0 ETH");
  const wr = await rq("Test payee", "0.0001", "ETH", "weekly");
  check("over the weekly budget is blocked by that rule", wr.status === "blocked" && wr.rule === "weekly budget");
  delete cfg3.rules.weekly; cfg3.rules.daily.ETH = "1"; cfg3.notify = { type: "webhook", url: "https://127.0.0.1:9/reinpay-test" }; C.saveConfig(cfg3);
  const nt = await rq("Test payee", "0.0013", "ETH", "notify test");
  check(`a waiting payment tries to notify the owner and logs the result on the receipt (${nt.history.at(-1)?.note})`, nt.status === "needs_approval" && /Owner notification failed/.test(nt.history.at(-1)?.note || ""));
  check("get_rules tells the agent the owner is notified, without the webhook address", P.rulesView().ownerNotifiedBy === "webhook" && !JSON.stringify(P.rulesView()).includes("127.0.0.1"));
  P.reject(nt.id, "Test cleanup.");
  delete cfg3.notify; cfg3.rules.daily.ETH = "0.005"; C.saveConfig(cfg3);
}
let threw = "";
try { await P.approve(r8.id); } catch (e) { threw = e.message; }
check("a blocked payment cannot be approved", /only waiting payments/.test(threw));

// ---- the MCP server over stdio: the agent's view ----
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
const mcp = new Client({ name: "reinpay-live-test", version: "0.0.0" });
await mcp.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL("../bin/reinpay.js", import.meta.url)), "mcp"], env: { ...process.env, REINPAY_HOME: home } }));
const names = (await mcp.listTools()).tools.map((t) => t.name).sort();
check(`the agent gets 5 tools (${names.join(", ")})`, names.join() === "get_receipt,get_rules,list_receipts,request_payment,wallet_status");
check("no tool can approve, reject or change rules or payees", !names.some((n) => /approve|reject|rule_set|payee|unlock|autosend/.test(n)));
const call = async (name, args = {}) => { const r = await mcp.callTool({ name, arguments: args }); return { err: !!r.isError, text: r.content.map((x) => x.text).join("") }; };
const rules = JSON.parse((await call("get_rules")).text);
check("get_rules lists the payees and today's ETH budget", rules.payees.length === 2 && /ETH$/.test(rules.tokens.ETH.dailyBudget));
const st = JSON.parse((await call("wallet_status")).text);
check(`wallet_status reads real balances (the throwaway wallet holds ${st.balances.ETH} ETH)`, st.address === me && st.balances.ETH === "0");
const m1 = JSON.parse((await call("request_payment", { payee: "Not on list", amount: "1", memo: "x" })).text);
check("request_payment to an unlisted payee is blocked over MCP", m1.status === "blocked" && m1.rule === "payee list");
const m2 = JSON.parse((await call("request_payment", { payee: "Test payee", amount: "0.0001", token: "ETH", memo: "real balance" })).text);
check("over MCP, with the real (empty) balance, the payment is blocked before signing", m2.status === "blocked" && m2.rule === "simulation");
const m3 = await call("request_payment", { payee: "Test payee", amount: "1e3", memo: "x" });
check("a malformed amount is refused", m3.err && /positive decimal/.test(m3.text));
const list = JSON.parse((await call("list_receipts", { limit: 5 })).text);
check("list_receipts returns the newest first", list.length === 5 && list[0].id === m2.id);
const one2 = JSON.parse((await call("get_receipt", { id: r1.id })).text);
check("get_receipt shows the history of an approval that was refused", one2.history.some((h) => /Approval refused/.test(h.note)));
await mcp.close();

console.log(`\n${pass} passed, ${fail} failed. Nothing was signed or sent.`);
process.exit(fail ? 1 : 0);
