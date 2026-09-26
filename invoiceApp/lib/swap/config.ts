// Chain-specific addresses for Universal Router / Permit2 / the v4 Quoter, plus
// pool metadata used to build swap routes for accepted tokens.
//
// IMPORTANT: adding a token here does NOT whitelist it on-chain — it only supplies
// pool fee/tickSpacing/hooks for PayPanel. The merchant must call
// setAcceptedToken(token, true) on InvoiceContract (see AcceptedTokensPanel).
// That same allow-list (`acceptedTokens`) gates invoice creation and swap tokenIn.
// If an entry here is not accepted on-chain, it is hidden from the payer dropdown.
//
// poolFee/tickSpacing/hooks must match a pool that actually exists for
// (token, invoice.token) — confirm these before using them in production, e.g. via
// https://docs.uniswap.org/contracts/v4/deployments and the Uniswap pool explorer.
//
// Universal Router / Permit2 / Quoter addresses: confirm the current ones for your
// chain at https://docs.uniswap.org/contracts/v4/deployments before deploying —
// these change over time and per chain.

export interface SwapToken {
  symbol: string;
  address: string;
  decimals: number;
  poolFee: number;
  tickSpacing: number;
  hooks: string; // usually the zero address (no hook) unless the pool has one
}

export interface ChainSwapConfig {
  universalRouter: string;
  permit2: string;
  quoter: string;
  tokens: SwapToken[];
}

const ZERO = "0x0000000000000000000000000000000000000000";

// Mainnet v4 addresses. Anvil forks mainnet, so chainId 31337 reuses these.
// https://docs.uniswap.org/contracts/v4/deployments
const MAINNET_UNIVERSAL_ROUTER = "0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af";
const MAINNET_PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const MAINNET_V4_QUOTER = "0x52F0E24D1c21C8A0cB1e5a5dD6198556BD9E1203";

const MAINNET_TOKENS: SwapToken[] = [
  {
    symbol: "USDC",
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    decimals: 6,
    poolFee: 500,
    tickSpacing: 10,
    hooks: ZERO,
  },
  {
    symbol: "USDT",
    address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    decimals: 6,
    poolFee: 500,
    tickSpacing: 10,
    hooks: ZERO,
  },
  {
    symbol: "JPYC",
    address: "0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29",
    decimals: 18,
    poolFee: 3000,
    tickSpacing: 60,
    hooks: ZERO,
  },
];

const MAINNET_SWAP: ChainSwapConfig = {
  universalRouter: process.env.NEXT_PUBLIC_UNIVERSAL_ROUTER || MAINNET_UNIVERSAL_ROUTER,
  permit2: process.env.NEXT_PUBLIC_PERMIT2 || MAINNET_PERMIT2,
  quoter: process.env.NEXT_PUBLIC_V4_QUOTER || MAINNET_V4_QUOTER,
  tokens: MAINNET_TOKENS,
};

// https://docs.uniswap.org/contracts/v4/deployments  (Sepolia, 11155111)
const SEPOLIA_UNIVERSAL_ROUTER = "0x3A9D48AB9751398BbFa63ad67599Bb04e4BdF98b";
const SEPOLIA_V4_QUOTER = "0x61b3f2011a92d183c7dbadbda940a7555ccf9227";

// Circle native USDC on Ethereum Sepolia. Official Tether USDT is not deployed there.
// JPYC testnet uses the same address as mainnet (JPYC developer docs).
const SEPOLIA_TOKENS: SwapToken[] = [
  {
    symbol: "USDC",
    address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    decimals: 6,
    poolFee: 500,
    tickSpacing: 10,
    hooks: ZERO,
  },
  {
    symbol: "JPYC",
    address: "0xE7C3D8C9a439feDe00D2600032D5dB0Be71C3c29",
    decimals: 18,
    poolFee: 3000,
    tickSpacing: 60,
    hooks: ZERO,
  },
];

const SEPOLIA_SWAP: ChainSwapConfig = {
  universalRouter: SEPOLIA_UNIVERSAL_ROUTER,
  permit2: MAINNET_PERMIT2,
  quoter: SEPOLIA_V4_QUOTER,
  tokens: SEPOLIA_TOKENS,
};

export const SUPPORTED_APP_CHAIN_IDS = [1, 31337, 11155111] as const;

export function isSupportedAppChain(chainId: number | null): boolean {
  return chainId != null && (SUPPORTED_APP_CHAIN_IDS as readonly number[]).includes(chainId);
}

export const SWAP_CONFIG: Record<number, ChainSwapConfig> = {
  1: MAINNET_SWAP,
  31337: MAINNET_SWAP,
  11155111: SEPOLIA_SWAP,
};

export function getSwapConfig(chainId: number | null): ChainSwapConfig | null {
  if (chainId == null) return null;
  return SWAP_CONFIG[chainId] ?? null;
}
