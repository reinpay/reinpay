# Reinpay

A wallet for AI agents that only spends inside your rules.

Your agent can read its budget and ask for payments. You decide the rules: a daily budget per token, a max per payment, the payees it may pay, and the amount above which it has to ask you. Every payment is simulated on **Robinhood Chain mainnet** (chain id 4663) before anything is signed, and every request gets a receipt that names the rule that decided it.

Version 0.1.0. USDG and ETH. Works with any MCP host that runs a local command (Claude Code, Cursor, Codex, Windsurf, VS Code and others).

## How a payment works

1. The agent calls `get_rules`, then `request_payment` with a payee from your list, an amount and a memo.
2. Reinpay checks the rules, in this order:
   - the payee is on your list and switched on, and may be paid in that token;
   - the amount is above zero and not above the max per payment (yours, and the payee's own if set);
   - today's budget for that token still has room, counting payments already sent **and** payments still waiting for you;
   - the same payee, token and amount was not asked for within the repeat guard (default 10 minutes); if it was, it waits for you;
   - the amount is not above your approval line; if it is, it waits for you.
3. The payment is simulated on mainnet with `eth_simulateV1`. The simulation must show exactly one thing leaving the wallet: that amount of that token, to that payee. The wallet must also hold enough ETH for the network fee.
4. What happens next:
   - **blocked**: nothing is signed. The receipt says which rule and why.
   - **needs_approval**: waits for you.
   - **ready**: inside every rule, and waits for you because `autosend` is off (the default) or the wallet is locked.
   - **sending / sent**: only when you turned `autosend` on and ran `reinpay unlock`.
5. `reinpay approve <id>` checks the budget again, simulates again, asks you to type `yes`, then signs and sends.

The agent cannot approve its own requests, change rules, or add payees. Those commands exist only in your terminal and refuse to run without one.

## Install

Node.js 22.12.0 or newer.

```sh
npm install -g https://github.com/reinpay/reinpay/archive/refs/heads/main.tar.gz
reinpay --version
```

## Set up (in your own terminal)

```sh
reinpay init                      # new wallet (or: reinpay init --import)
reinpay payee add "Weather API" 0xRecipientAddress --tokens=USDG --note="data bundles"
reinpay rule daily USDG 25        # daily budget
reinpay rule max USDG 10          # max per payment
reinpay rule approve-above USDG 5 # above this, it asks you
reinpay rules                     # check everything
reinpay address                   # fund this address with a small amount only
```

Then add the MCP server to your agent host. For Claude Code:

```sh
claude mcp add --scope user reinpay -- reinpay mcp
```

Any other host: run `reinpay mcp` as a stdio server.

## Day to day

```sh
reinpay pending                   # what is waiting for you
reinpay approve RP-00012          # re-check, re-simulate, type yes, send
reinpay reject RP-00013
reinpay receipts                  # everything, newest first (--json for a file)
reinpay autosend on               # optional: send payments inside every rule without asking
reinpay unlock                    # needed for autosend; reinpay lock removes the passphrase file
```

## Tools for the agent

| Tool | What it does |
| --- | --- |
| `wallet_status` | Address, ETH and USDG balances, today's budget left per token, the rules |
| `get_rules` | The rules and the payees the agent may pay |
| `request_payment` | Ask for one payment; returns the decision and the receipt |
| `get_receipt` | One receipt by id |
| `list_receipts` | Recent receipts, optionally by status |

## Where things are kept

Everything is in `~/.reinpay` (or `$REINPAY_HOME`), readable by you only:

- `keystore.json`: the key, encrypted with scrypt and AES-256-GCM.
- `passphrase`: only while unlocked.
- `config.json`: rules and payees.
- `receipts.json`: every request and what happened to it.

Nothing is sent anywhere except to the Robinhood Chain RPC (`https://rpc.mainnet.chain.robinhood.com`, or `REINPAY_RPC`).

## Defaults

| Rule | USDG | ETH |
| --- | --- | --- |
| Daily budget | 25 | 0.005 |
| Max per payment | 10 | 0.002 |
| Asks you above | 5 | 0.001 |

The repeat guard is 10 minutes, and `autosend` is off. A token with no daily budget cannot be spent. There are no payees until you add one.

## Limits of this version

- One wallet per computer, two tokens (USDG at `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`, and ETH).
- Budgets are per token and per local calendar day. There is no conversion between tokens.
- Run one MCP server per wallet. Receipts are written atomically, but two processes requesting payments at the same instant could both see the same remaining budget.
- The simulation checks what leaves the wallet. It cannot check that a payee delivers what you paid for.

## Tests

```sh
npm test
```

`test/rules.test.mjs` checks every rule offline. `test/live.mjs` runs on mainnet:

- USDG transfer simulations from a public holder, and tampered ones that must be refused;
- the full flow with a throwaway wallet that has a pretend ETH balance only inside the simulation;
- the MCP server over stdio.

Nothing is signed or sent.

## Licence

MIT. Nothing here is financial advice.
