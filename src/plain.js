// reinpay rules --plain: the rules as sentences a person (or the agent, explaining to its user) can read out loud.
// Pure: it reads the config it is given. Blocked memo words are counted, never listed.
const list = (o) => Object.entries(o || {}).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([t, v]) => `${v} ${t}`);
const or = (a) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} or ${a.at(-1)}`);
const and = (a) => (a.length <= 1 ? a.join("") : `${a.slice(0, -1).join(", ")} and ${a.at(-1)}`);

export function plainRules(cfg, { frozen = null } = {}) {
  const r = cfg.rules || {}, L = [];
  if (frozen) L.push(`Reinpay is frozen (${frozen.reason}): nothing is paid until you unfreeze it.`);
  L.push(list(r.daily).length ? `Your agent can spend up to ${and(list(r.daily))} a day.` : "Your agent has no daily budget, so it cannot spend anything.");
  if (list(r.weekly).length) L.push(`At most ${and(list(r.weekly))} a week (weeks start on Monday).`);
  if (list(r.monthly).length) L.push(`At most ${and(list(r.monthly))} a month.`);
  if (list(r.maxPerPayment).length) L.push(`One payment can be at most ${or(list(r.maxPerPayment))}.`);
  if (r.balanceShare) L.push(`One payment can be at most ${r.balanceShare}% of the wallet's balance of that token.`);
  if (r.usd?.max != null) L.push(`One payment can be worth at most ${r.usd.max} USD.`);
  if (r.usd?.daily != null) L.push(`All payments together can be worth at most ${r.usd.daily} USD a day.`);
  if (list(r.approveAbove).length) L.push(`Above ${or(list(r.approveAbove))}, a payment waits for you.`);
  if (r.cosign?.by) L.push(`Above ${or(list(r.cosign.above))}, a payment also needs a signature from ${r.cosign.by}.`);
  if (Number(r.repeatGuardMinutes)) L.push(`The same payment again within ${r.repeatGuardMinutes} minutes waits for you.`);
  if (r.firstPayment === "ask") L.push("The first payment to every payee waits for you.");
  if (r.requireProven) L.push("Payments to payees that have not proved their address wait for you.");
  if (r.hours) L.push(`Outside ${r.hours.from}:00 to ${r.hours.to}:00${r.hours.weekdays ? " on weekdays" : ""}, every payment waits for you.`);
  if (r.maxPerHour) L.push(`At most ${r.maxPerHour} payments an hour.`);
  if (r.maxPerDay) L.push(`At most ${r.maxPerDay} payments a day.`);
  if (r.memoMin) L.push(`Every payment needs a memo of at least ${r.memoMin} characters saying what it is for.`);
  if (r.memoBlock?.length) L.push(`A memo with one of ${r.memoBlock.length} words or phrases you block is refused.`);
  if (r.maxFeeEth) L.push(`While the network fee is above ${r.maxFeeEth} ETH, payments are blocked.`);
  if (r.expireAfterMinutes) L.push(`A payment left waiting for ${r.expireAfterMinutes >= 120 && r.expireAfterMinutes % 60 === 0 ? `${r.expireAfterMinutes / 60} hours` : `${r.expireAfterMinutes} minutes`} expires.`);
  for (const [cat, c] of Object.entries(r.categories || {})) if (list(c.daily).length) L.push(`Payees in "${cat}" share ${and(list(c.daily))} a day.`);
  const ps = (cfg.payees || []).filter((p) => !p.disabled);
  L.push(ps.length ? `Only these payees can be paid: ${and(ps.map((p) => p.name))}.` : "There are no payees yet, so nothing can be paid.");
  for (const p of ps) {
    const s = [];
    if (list(p.daily).length) s.push(`at most ${and(list(p.daily))} a day`);
    if (list(p.maxPerPayment).length) s.push(`at most ${or(list(p.maxPerPayment))} per payment`);
    if (list(p.approveAbove).length) s.push(`asks you above ${or(list(p.approveAbove))}`);
    if (p.cooldownMinutes) s.push(`at least ${p.cooldownMinutes} minutes between payments`);
    if (p.tokens) s.push(`only in ${or(p.tokens)}`);
    if (p.expiresAt) s.push(`until ${p.expiresAt.slice(0, 16).replace("T", " ")}`);
    if (s.length) L.push(`${p.name}: ${s.join("; ")}.`);
  }
  const b = r.breaker;
  L.push(b === "off" || b === false ? "The circuit breaker is off." : `If the agent is blocked ${b?.count ?? 5} times in ${b?.minutes ?? 10} minutes, Reinpay freezes itself.`);
  L.push(r.autoSend ? "Payments inside every rule are sent without asking you, while the wallet is unlocked." : "Even payments inside every rule wait for you, because autosend is off.");
  L.push("Every payment is simulated on Robinhood Chain mainnet before anything is signed.");
  return L;
}
