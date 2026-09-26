import { Contract, JsonRpcProvider } from "ethers";

const QUOTER_ABI = [
  // Deployed V4 Quoter takes one QuoteExactSingleParams struct, not flattened args.
  // Flattened encoding hits the wrong selector and reverts with empty data.
  "function quoteExactOutputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amountIn, uint256 gasEstimate)",
];

export interface PoolKeyInput {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
}

/**
 * Quotes the tokenIn needed for an exact-output swap.
 *
 * The v4 Quoter is NOT a real view function — it works by reverting with the answer
 * encoded in the revert data — so it must be called via a static (simulated) call,
 * never sent as a real transaction, and never called from inside another on-chain
 * contract. https://docs.uniswap.org/sdk/v4/guides/swaps/quoting
 *
 * Note for anyone coming from the Uniswap docs' ethers v5 examples: this uses ethers
 * v6's `fn.staticCall(...)`, not the v5-style `contract.callStatic.fn(...)` namespace.
 */
export async function quoteExactOutputSingle(params: {
  rpcUrl: string;
  quoterAddress: string;
  poolKey: PoolKeyInput;
  zeroForOne: boolean;
  amountOut: bigint;
}): Promise<{ amountIn: bigint; gasEstimate: bigint }> {
  const provider = new JsonRpcProvider(params.rpcUrl);
  const quoter = new Contract(params.quoterAddress, QUOTER_ABI, provider);
  const [amountIn, gasEstimate] = await quoter.quoteExactOutputSingle.staticCall({
    poolKey: params.poolKey,
    zeroForOne: params.zeroForOne,
    exactAmount: params.amountOut,
    hookData: "0x",
  });
  return { amountIn, gasEstimate };
}

/** Apply a slippage buffer on top of a raw quote before using it as maxAmountIn. */
export function withSlippageBuffer(amountIn: bigint, bufferBps: number): bigint {
  return (amountIn * BigInt(10_000 + bufferBps)) / 10_000n;
}
