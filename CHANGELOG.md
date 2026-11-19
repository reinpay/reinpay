# Changelog

## 0.11.0 (unreleased): smarter rules

- Category budgets: `reinpay payee category <payee> <name|off>` and `reinpay rule category <name> daily <token> <amount|off>`. Every payee in a category shares that daily budget, on top of the overall one (rule `category budget`). Receipts store the category, `reinpay report` adds a By category section, shared payee lists carry it, and `get_rules` shows it.
- Payment hours: `reinpay rule hours <9-18|off> [--weekdays]`, local time, wrapping past midnight for ranges like `22-6`. Outside them every payment waits for the owner (rule `quiet hours`); hard limits still block first.
- Payments per hour: `reinpay rule per-hour <count|0>` blocks a payment once that many were sent or are waiting in the last 60 minutes (rule `payments per hour`). Blocked requests do not count.
- All three are off by default, so existing configs and their seals are unchanged.
- Tests: 25 checks offline, plus 2 new live mainnet checks. All passing. No transaction is signed or sent.

## 0.10.0 (unreleased): working with others

- `reinpay payee export [--out=file.json]` and `reinpay payee import <file>`: share a payee list signed with your wallet key. Import checks the signature, says who signed it (and warns when it is not this wallet), and adds only payees that pass the same checks as `payee add`; duplicates, taken names, expired payees and lookalike addresses are skipped and listed, and token contracts are still refused.
- Signed webhooks: a webhook set up with `reinpay notify webhook <url>` gets a secret, printed once. Every POST carries `x-reinpay-timestamp` and `x-reinpay-signature` (`sha256=` HMAC-SHA256 of `<timestamp>.<body>`), so the receiving server can reject anything forged or replayed. `reinpay notify secret` rotates it. Webhooks set up before 0.10 keep working unsigned until you run it.
- `reinpay mcp --read-only`: the MCP server without `request_payment`, for agents that should only read, dry-run and verify. `freeze_wallet` stays available.
- Tests: 22 payee-list, webhook and read-only checks offline, plus 4 new live mainnet checks. All passing. No transaction is signed or sent.

## 0.9.0 (unreleased): plan and move

- Dry run: `reinpay check <payee> <amount> [token]` and the new MCP tool `check_payment` say what would happen to a payment right now (blocked with the rule, waiting for you, ready or sent), simulated on mainnet when the rules would let it through. No receipt, nothing counted against a budget, nothing signed, and the circuit breaker does not count it.
- Budget grants: `reinpay grant <token> <amount> --for=2h [--note=...]` adds to today's budget until the time is up (up to 30 days); `grant list` and `grant clear`. Grants live in the sealed rules; `get_rules` shows them inside today's budget.
- `reinpay backup [--out=file.json]` and `reinpay restore <file>`: move a wallet to another computer. The keystore stays encrypted, the passphrase file is never included, files are written readable by the owner only. Restore refuses to overwrite a wallet, refuses a backup whose hash does not match, and reports the config seal.
- Tests: 24 grant, dry-run and backup checks offline, plus 2 new live mainnet checks. All passing. No transaction is signed or sent.

## 0.8.0 (unreleased): proof and paperwork

- `reinpay statement [--days=30] [--out=file.json]`: every sent payment in the period, with totals per token, signed with the wallet's own key. `reinpay statement check <file>` needs no wallet: it checks that the wallet named in the file signed it, that it was not changed after signing, and reads every payment back from Robinhood Chain. A statement signed by someone else, or listing a payment the wallet did not make, is refused.
- First-payment rule: `reinpay rule first-payment ask` makes the first payment to every payee wait for the owner, even inside the approval line. Hard limits still apply first. `off` turns it off (the default).
- `reinpay digest [--days=1] [--dry]`: a short summary (sent, waiting, blocked, what blocked most, and a freeze if there is one) sent to the owner's Telegram or webhook. Read-only, for a daily schedule.
- `get_rules` shows whether first payments need the owner.
- Tests: 23 statement, first-payment and digest checks offline, plus 3 new live mainnet checks. All passing. No transaction is signed or sent.

## 0.7.0 (unreleased): brakes

- `reinpay freeze [reason]`: one command stops every payment. Requests are blocked with the rule `frozen`, autosend stops even for a payment already decided, and `reinpay approve` refuses. `reinpay unfreeze` is terminal only and asks whether you checked your receipts. The state is kept in `frozen.json`, apart from the sealed config; an unreadable file counts as frozen.
- Circuit breaker: when the agent is blocked 5 times within 10 minutes, Reinpay freezes itself and notifies the owner (Telegram or webhook, event `frozen`). `reinpay rule breaker <count> <minutes>` or `off`. Requests blocked by the freeze itself, waiting payments and the owner's own test requests do not count.
- New MCP tool `freeze_wallet`: the agent can pull the brake if it notices it is being told to pay someone it should not. No tool can unfreeze.
- Expiring payees: `reinpay payee add ... --until=30d`, and `reinpay payee until <name> <30d|12h|90m|off>`. An expired payee is blocked (rule `payee expired`) and no longer shown to the agent.
- `reinpay doctor` has a tenth check, brakes; `reinpay status` and `get_rules` show the freeze and the breaker.
- Tests: 29 freeze/breaker/expiry checks offline and 2 more doctor checks, plus 4 new live mainnet checks. All passing. Nothing is signed or sent.

## 0.6.0 (unreleased): check it

- `reinpay verify <RP-id>` (and `--all`) reads a sent payment back from Robinhood Chain and checks it against its receipt: on chain 4663, confirmed and succeeded, the same block, sent from your wallet, one transfer out to the payee, the exact amount of the right token, no ETH sent along with a token call. Each check says what it compared. New MCP tool `verify_receipt`, so an agent can check a payment before telling you it arrived.
- Lookalike guard: `reinpay payee add` refuses an address that starts and ends like a payee you already have, or like your own wallet (address poisoning). To add it anyway you type the full address again. The payee is then marked as confirmed.
- `reinpay doctor` (`--json`): nine read-only checks with what to do next: Node.js version, wallet, RPC, chain id, config seal, unlock, ETH for network fees, payees (including lookalike pairs) and daily budgets. Exits with 1 when something must be fixed.
- Receipts now store the token contract address, so `verify` still works if a token is later removed from your list.
- Tests: 12 guard, 14 verify and 20 doctor checks offline, plus 17 new live mainnet checks. All passing. Nothing is signed or sent.

## 0.5.0 (unreleased): hardening

- Config seal: every change made with the owner's terminal commands (`rule`, `payee`, `token`, `notify`, `autosend`, and `init`) is signed with the wallet's own key. Before anything is signed, `reinpay approve` and autosend check that signature. If `config.json` was edited any other way (an agent with file access adding itself as a payee, raising a budget, turning autosend on), nothing is signed until the owner checks `reinpay rules` and runs `reinpay seal`. Existing wallets: run `reinpay seal` once after updating.
- Unlock that expires: `reinpay unlock --for=30m` (also `2h`, `1d`; `0` keeps it until `reinpay lock`). The default is 12 hours. When the time is up the passphrase file is removed and signing needs the passphrase again.
- `reinpay status` shows the seal and how long the wallet stays unlocked.
- Tests: 55 rule, 7 lock, 9 report, 11 notification, 10 CSV, 9 profile and 15 seal/unlock checks offline, and 59 live mainnet checks. All passing. Nothing is signed or sent.

## 0.4.1 (unreleased): security fix

- Fixed: `reinpay approve` signed the raw transaction stored in `receipts.json`, while the second simulation used a transaction built fresh from the payee list and the amount. Anything able to edit `receipts.json` could have made the owner approve one payment and sign another. Approve now builds the transaction from the payee list and the amount, simulates exactly that transaction, and signs exactly that transaction. Raw transactions are no longer written to `receipts.json` at all, and a receipt whose payee address is not on the payee list is refused. Reported publicly; thank you.
- README: a "Security model" section that states plainly what Reinpay protects against and what it does not (an agent that can run arbitrary shell commands as your user).
- Tests: 56 live mainnet checks, including a receipt edited to point at another address being refused with nothing signed.

## 0.4.0 (unreleased)

- One wallet per agent: `--profile=<name>` on any command (`reinpay init --profile=research`, `reinpay mcp --profile=research`). Each profile has its own key, rules, payees, receipts and spend lock in `~/.reinpay/profiles/<name>`; the default stays in `~/.reinpay`. `reinpay profiles` lists them. Names are 1-32 lowercase letters, digits or dashes.
- More tokens: `reinpay token add <0xaddress>` adds another ERC-20 on Robinhood Chain after checking that it has code, answers like a token (symbol and decimals), does not clash with a token already known, and is verified on Sourcify (exact or partial match). An added token cannot be spent until the owner sets its daily budget. `reinpay token list`, `reinpay token remove <SYMBOL>`. Balances, budgets and simulations cover added tokens; `request_payment` accepts any token `get_rules` lists.
- CSV export: `reinpay receipts --csv` (every receipt, oldest first) and `reinpay report --csv` (one row per day and token). Text that a spreadsheet would run as a formula, such as a memo starting with `=`, is written as plain text.
- The message for a token contract refused as a payee now names the token.
- Tests: 55 rule, 7 lock, 9 report, 11 notification, 10 CSV and 9 profile checks offline, and 53 live mainnet checks, including a Sourcify-verified token added and an unverified one refused. All passing. Nothing is signed or sent.

## 0.3.0 (unreleased)

- Token contracts are never payees. `reinpay payee add` refuses any address that answers like an ERC-20 token (its `decimals` and `totalSupply` can be read), because tokens sent to a token's own contract are almost always stuck for good. A token contract added to `config.json` by hand is blocked at payment time with the rule `token contract`. Contracts that are not tokens can still be payees and are flagged as contracts.
- Weekly and monthly budgets: `reinpay rule weekly USDG 100`, `reinpay rule monthly USDG 300` (`off` removes them). Local calendar weeks start on Monday. They are checked after the daily budget, counting payments sent and still waiting, and `get_rules` shows what is left.
- Owner notifications: `reinpay notify telegram <bot-token> <chat-id>` or `reinpay notify webhook <https-url>`, then `reinpay notify test`. When a payment waits for approval, the owner gets the id, amount, payee, the rule that held it and the command to approve or reject. The agent's memo is shortened and quoted. A failed notification never changes the payment; the result is written on the receipt. The bot token and webhook stay in `config.json` and are never shown to the agent.
- Tests: 55 offline rule checks, 7 lock, 9 report and 11 notification checks, and 42 live mainnet checks. All passing. Nothing is signed or sent.

## 0.2.0 (unreleased)

- Spend lock: deciding a payment (rules, mainnet simulation, receipt) now runs one at a time across every Reinpay process on the computer, so two requests at the same moment can no longer both spend the same budget left. The same lock covers `reinpay approve`. A lock left by a process that exited is cleared automatically.
- Per-payee daily budget: `reinpay payee limit <name> daily <USDG|ETH> <amount>` caps what one payee can receive per local day, on top of the wallet's daily budget. `reinpay payee limit <name> max ...` sets the payee's own max per payment from the terminal. `off` clears either. The agent sees each payee's limits and what is left today in `get_rules`.
- `reinpay report [--days=7] [--json]`: what was sent, what is waiting and what was blocked, per day and token, the top payees per token and the rules that blocked the most. Read from local receipts only.
- `reinpay approve` checks that the payment is still waiting and opens the wallet before taking the lock, so a wrong passphrase changes nothing.
- Tests: 43 offline rule checks, 7 lock checks (including two processes), 9 report checks, and 35 live mainnet checks, including two simultaneous requests against one budget. All passing. Nothing is signed or sent.

## 0.1.0 (unreleased)

First version: a wallet for AI agents that only spends inside the owner's rules, on Robinhood Chain mainnet (chain id 4663).

- Rules per token (USDG, ETH): daily budget, max per payment, approval line. A repeat guard holds the same payment asked again within 10 minutes.
- Payee list with per-payee tokens and an optional per-payee max. Payees can be switched off. Unlisted payees are always blocked.
- Every payment is simulated with `eth_simulateV1` (traceTransfers). It is refused unless exactly one transfer of the asked amount leaves the wallet, to the payee, and the wallet can pay the network fee.
- Receipts for every request: status, the rule that decided, the simulation, and the transaction once sent.
- MCP server with 5 tools: `wallet_status`, `get_rules`, `request_payment`, `get_receipt`, `list_receipts`. The agent cannot approve, reject, or change rules or payees.
- Owner commands in the terminal only: `init`, `unlock`/`lock`, `rule`, `payee`, `autosend`, `pending`, `approve` (re-checks the budget and simulates again before signing), `reject`, `receipts`, `export`.
- Encrypted key (scrypt + AES-256-GCM) in `~/.reinpay`.
- Tests: 33 offline rule checks and 30 live mainnet checks, all passing. Nothing is signed or sent.
