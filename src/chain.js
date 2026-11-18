// Robinhood Chain mainnet (chain id 4663): the client and the two assets Reinpay spends.
import { createPublicClient, defineChain, http, getAddress } from "viem";
import { loadConfig } from "./config.js";

export const CHAIN_ID = 4663;
export const DEFAULT_RPC = "https://rpc.mainnet.chain.robinhood.com";
export const EXPLORER = "https://robinhoodchain.blockscout.com";

// USDG (Global Dollar) on Robinhood Chain. live.mjs checks symbol, decimals and code on every run.
export const TOKENS = {
  ETH: { symbol: "ETH", decimals: 18, address: null },
  USDG: { symbol: "USDG", decimals: 6, address: getAddress("0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168") },
};

export const robinhoodChain = defineChain({
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [DEFAULT_RPC] } },
  blockExplorers: { default: { name: "Blockscout", url: EXPLORER } },
});

export const rpcUrl = () => process.env.REINPAY_RPC || loadConfig().rpc || DEFAULT_RPC;
export const transport = () => http(rpcUrl(), { timeout: 30_000, retryCount: 2 });

let client;
export function publicClient() {
  if (!client) client = createPublicClient({ chain: robinhoodChain, transport: transport() });
  return client;
}

export const txLink = (hash) => `${EXPLORER}/tx/${hash}`;
export const addrLink = (a) => `${EXPLORER}/address/${a}`;

export function token(symbol) {
  const t = TOKENS[String(symbol || "").toUpperCase()];
  if (!t) throw new Error(`Unknown token "${symbol}". Reinpay spends ${Object.keys(TOKENS).join(" and ")}.`);
  return t;
}
