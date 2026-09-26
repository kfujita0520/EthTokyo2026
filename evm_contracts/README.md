# InvoiceContract

One deployment per merchant. The payee is set in the constructor and can be
updated later by the current merchant. 

Native ETH invoices use `token = address(0)`. ERC-20 invoices and swap
`tokenIn` must be on `acceptedTokens`. ETH itself is not listed there.

## Payment paths

| Function | When to use |
| --- | --- |
| `payInvoiceETH` | Invoice token is native ETH; payer sends `msg.value == amount`. |
| `payInvoiceERC20` | Payer holds the invoice token and has approved this contract. |
| `payInvoiceWithRouterSwap` | Payer spends a different accepted ERC-20; client-built Uniswap v4 Universal Router calldata swaps to the invoice token in the same transaction. |

ETH invoices can also be settled via `payInvoiceWithRouterSwap` (swap an
accepted ERC-20 to ETH). `tokenIn` cannot be native ETH.

Swap calldata is built off-chain with Uniswap v4-sdk (`V4Planner`) and
universal-router-sdk (`RoutePlanner`). See `invoiceApp/lib/swap/payInvoiceWithRouterSwap.ts`.

## Why swap-and-pay lives on this contract

A separate wrapper that called an unmodified `payInvoiceERC20` would fail two
invariants:

1. **Identity.** Universal Router / Permit2 pull tokens as `msgSender()` of
   `execute()`, which is the contract that called the router — not the human
   payer. A wrapper would need its own Permit2 allowance, so it must first
   `transferFrom` the payer. That pull belongs on the same contract that
   settles the invoice.
2. **Payer restriction.** `payInvoiceERC20` checks
   `inv.payer != address(0) && inv.payer != msg.sender`. If a wrapper called
   it, `msg.sender` would be the wrapper, so restricted invoices would reject
   the real payer.

Keeping bookkeeping and swap settlement on one contract avoids both issues.

## Swap trust model

`commands` / `inputs` are opaque. This contract does not inspect which pool or
hook they use. It trusts Uniswap's Universal Router to execute, then verifies
the **result** before funds leave:

- Only merchant-accepted ERC-20s may be invoice tokens or swap `tokenIn`.
- At most `maxAmountIn` is pulled from the payer; unspent `tokenIn` is refunded.
- After the swap, this contract's balance of `inv.token` (ETH when
  `address(0)`) must have grown by at least `inv.amount`. The calldata's own
  claims are not trusted.
- The Permit2 allowance granted to Universal Router is limited to this call's
  `tokenIn` / `maxAmountIn` and is revoked before return. No standing allowance
  survives the transaction.

`receive()` exists so Universal Router can send native ETH when settling an
ETH invoice via swap.

## Local workflow

```shell
forge build
forge test
```

Seed a mainnet-fork Anvil (PublicNode or similar as `--fork-url`, chain id 31337) with `script/SeedLocalInvoices.s.sol`. The fork keeps mainnet Uniswap v4 pool liquidity, so swap-and-pay can be tried against real pool state. The script deploys `InvoiceContract` with CREATE2 and then creates the local invoices to keep address consistent during the test. The contract address in `.env` must be that CREATE2 address. 
