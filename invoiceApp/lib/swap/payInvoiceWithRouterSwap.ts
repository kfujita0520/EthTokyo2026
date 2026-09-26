/**
 * Adapted from the payInvoiceWithRouterSwap.client.ts you shared. Builds the
 * V4Planner/RoutePlanner calldata for an exact-output swap and calls the merchant's
 * InvoiceContract.payInvoiceWithRouterSwap in a single transaction — the contract
 * forwards this calldata to Universal Router and settles the invoice atomically.
 *
 * Only the plumbing changed (imports/types to fit this app's lib/ layout); the
 * approve → plan → call sequence is the same one discussed for
 * InvoiceContractWithRouterSwap.sol.
 */

import { Contract, type Signer } from "ethers";
import { Actions, V4Planner } from "@uniswap/v4-sdk";
import { CommandType, RoutePlanner } from "@uniswap/universal-router-sdk";
import { INVOICE_CONTRACT_ABI } from "../abi/InvoiceContract";
import type { PoolKeyInput } from "./quote";

const ERC20_ABI = [
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

export interface PayInvoiceWithRouterSwapParams {
  invoiceContractAddress: string;
  signer: Signer;
  invoiceId: bigint;
  tokenIn: string;
  tokenOut: string; // inv.token
  amountOut: bigint; // inv.amount — fixed by the invoice
  amountInMaximum: bigint; // slippage cap, from quoteExactOutputSingle + a buffer
  poolKey: PoolKeyInput;
  zeroForOne: boolean; // true if tokenIn === poolKey.currency0
}

/**
 * Step 1: plain ERC-20 approve() straight to the InvoiceContract (not Permit2, not
 *         Universal Router — the contract pulls maxAmountIn itself and manages its own
 *         short-lived Permit2 approval internally; see the Solidity comments for why).
 * Step 2: build the same v4 exact-output swap plan as the pure client-side flow.
 * Step 3: one transaction — swap AND settle the invoice, executed on the contract.
 */
export async function payInvoiceWithRouterSwap(p: PayInvoiceWithRouterSwapParams) {
  const invoiceContract = new Contract(p.invoiceContractAddress, INVOICE_CONTRACT_ABI, p.signer);
  const erc20In = new Contract(p.tokenIn, ERC20_ABI, p.signer);
  const signerAddress = await p.signer.getAddress();

  const allowance: bigint = await erc20In.allowance(signerAddress, p.invoiceContractAddress);
  if (allowance < p.amountInMaximum) {
    await (await erc20In.approve(p.invoiceContractAddress, p.amountInMaximum)).wait();
  }

  const v4Planner = new V4Planner();
  const routePlanner = new RoutePlanner();
  const deadline = Math.floor(Date.now() / 1000) + 3600;

  v4Planner.addAction(Actions.SWAP_EXACT_OUT_SINGLE, [
    {
      poolKey: p.poolKey,
      zeroForOne: p.zeroForOne,
      amountOut: p.amountOut,
      amountInMaximum: p.amountInMaximum,
      hookData: "0x",
    },
  ]);
  v4Planner.addAction(Actions.SETTLE_ALL, [p.tokenIn, p.amountInMaximum]);
  v4Planner.addAction(Actions.TAKE_ALL, [p.tokenOut, p.amountOut]);

  const encodedActions = v4Planner.finalize();
  routePlanner.addCommand(CommandType.V4_SWAP, [v4Planner.actions, v4Planner.params]);

  const tx = await invoiceContract.payInvoiceWithRouterSwap(
    p.invoiceId,
    p.tokenIn,
    p.amountInMaximum,
    routePlanner.commands,
    [encodedActions],
    deadline
  );
  return tx.wait();
}
