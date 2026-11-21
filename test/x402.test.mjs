// v0.52: reinpay x402 check, offline: reading a 402, judging it against a config, and the check with a pretend service.
import { readRequired, judgeOption, checkX402, x402Lines, USDG_DOMAIN } from "../src/x402.js";
import { TOOLS, READ_ONLY_TOOLS } from "../src/server.js";
let pass = 0, fail = 0;
const check = (label, cond, info = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"} ${label}${info ? ` (${info})` : ""}`); };
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", DEAD = "0x000000000000000000000000000000000000dEaD", OTHER = "0x00000000000000000000000000000000DeaDBeef";
const cfg = { payees: [{ name: "Weather API", address: DEAD, isContract: false }] };
const opt = (o = {}) => ({ scheme: "exact", network: "eip155:4663", amount: "10000", asset: USDG, payTo: DEAD, maxTimeoutSeconds: 60, extra: { name: "Global Dollar", version: "1" }, ...o });
const v2 = (accepts, extra = {}) => ({ "PAYMENT-REQUIRED": Buffer.from(JSON.stringify({ x402Version: 2, resource: { url: "https://api.example.com/forecast", description: "Hourly forecast" }, accepts, ...extra })).toString("base64") });
const r2 = readRequired({ headers: v2([opt()]) });
check("v2: the PAYMENT-REQUIRED header is read (version, resource, chain, amount in base units)", r2.version === 2 && r2.resource.description === "Hourly forecast" && r2.accepts[0].chainId === 4663 && r2.accepts[0].amountRaw === 10000n);
const r1 = readRequired({ headers: {}, body: JSON.stringify({ x402Version: 1, accepts: [{ scheme: "exact", network: "robinhood", maxAmountRequired: "250000", asset: USDG, payTo: DEAD, resource: "https://api.example.com/x", description: "One report" }] }) });
check("v1: a JSON body with maxAmountRequired and a network name is read too", r1.version === 1 && r1.accepts[0].chainId === 4663 && r1.accepts[0].amountRaw === 250000n && r1.resource.description === "One report");
let threw = false; try { readRequired({ headers: {}, body: "<html>pay me</html>" }); } catch (e) { threw = /did not say what it accepts/.test(e.message); }
check("a 402 that says nothing readable is refused with a plain reason", threw);
const j = judgeOption(r2, cfg);
check("on your payee list: 10000 base units of USDG is 0.01 USDG to \"Weather API\"", j.token === "USDG" && j.amount === "0.01" && j.payee === "Weather API" && !j.problem);
check("no option on Robinhood Chain: Reinpay says it cannot judge it, and names the networks", /not on Robinhood Chain|None of its/.test(judgeOption(readRequired({ headers: v2([opt({ network: "eip155:8453" })]) }), cfg).problem) && /eip155:8453/.test(judgeOption(readRequired({ headers: v2([opt({ network: "eip155:8453" })]) }), cfg).problem));
check("a token Reinpay does not spend is not judged", /does not spend/.test(judgeOption(readRequired({ headers: v2([opt({ asset: OTHER })]) }), cfg).problem));
check("only the exact scheme is read", /"upto" scheme/.test(judgeOption(readRequired({ headers: v2([opt({ scheme: "upto" })]) }), cfg).problem));
check("the Robinhood Chain option is picked among several", judgeOption(readRequired({ headers: v2([opt({ network: "eip155:8453", payTo: OTHER }), opt()]) }), cfg).payee === "Weather API");
check("a signing domain that is not USDG's is pointed out", judgeOption(readRequired({ headers: v2([opt({ extra: { name: "USD Coin", version: "2" } })]) }), cfg).notes.some((n) => n.includes(`${USDG_DOMAIN.name} ${USDG_DOMAIN.version}`)));
const fake = (status, headers = {}, body = "") => async () => ({ status, headers: new Headers(headers), text: async () => body });
const free = await checkX402("https://api.example.com/free", { fetch: fake(200), _config: cfg });
check("a 200 answer: no payment needed", free.needsPayment === false && x402Lines(free)[0].includes("does not ask for an x402 payment"));
let called = 0; const pv = async (a) => { called++; pv.last = a; return { wouldBe: "needs_approval", rule: "first payment", reason: "First payment to Weather API waits for you.", simulation: { ok: true, block: "123" } }; };
const stranger = await checkX402("https://api.example.com/x", { fetch: fake(402, v2([opt({ payTo: OTHER })])), _config: cfg, _preview: pv });
check("payTo not on your list: blocked by the payee list, no dry run needed, and the next step is payee check", stranger.wouldBe === "blocked" && stranger.rule === "payee list" && called === 0 && x402Lines(stranger).some((l) => l.includes(`reinpay payee check ${OTHER}`)));
const known = await checkX402("https://api.example.com/forecast", { fetch: fake(402, v2([opt()])), _config: cfg, _preview: pv });
check("payTo on your list: the same dry run as reinpay check, with the service's description as the memo", called === 1 && pv.last.payee === "Weather API" && pv.last.amount === "0.01" && pv.last.token === "USDG" && pv.last.memo === "Hourly forecast" && known.wouldBe === "needs_approval");
check("the lines say nothing was paid or signed", x402Lines(known).some((l) => l.includes("Nothing was paid or signed")));
threw = false; try { await checkX402("file:///etc/passwd", { fetch: fake(200), _config: cfg }); } catch (e) { threw = /http and https/.test(e.message); }
check("only http and https URLs are asked", threw);
check("check_x402 is an MCP tool, read-only", TOOLS.some((t) => t[0] === "check_x402" && t[4].readOnlyHint === true) && READ_ONLY_TOOLS.includes("check_x402"));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
