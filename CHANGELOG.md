# Changelog

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
