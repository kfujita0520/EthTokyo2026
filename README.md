# Swap-Pay Invoice

A merchant publishes invoices. A payer settles one in the invoice currency, or spends a different accepted token and swaps it to that currency through Uniswap v4 in the same transaction.

## Overview

One `InvoiceContract` deployment belongs to one merchant. The merchant creates invoices and maintains an allow-list of ERC-20s. Native ETH invoices are also supported.

A payer can:

- send ETH with `payInvoiceETH`
- pay the invoice ERC-20 with `payInvoiceERC20`
- spend another accepted ERC-20 and swap it to the invoice token (or to ETH) with `payInvoiceWithRouterSwap`

The Next.js app in `invoiceApp/` is the merchant and payer UI. Contract design and the local Anvil workflow are in `evm_contracts/README.md`.

## Uniswap

The app builds Uniswap v4 Universal Router calldata off-chain (`V4Planner` and `RoutePlanner`). The contract does not choose the pool. It pulls the payer's `tokenIn` through Permit2, calls Universal Router, and checks the result: its balance of the invoice token must increase by at least the invoice amount. Unspent `tokenIn` is refunded, and the Permit2 allowance is cleared before the call returns.

Pool fee, tick spacing, and hooks live in `invoiceApp/lib/swap/config.ts`. They are route metadata, not the on-chain allow-list. A token must be both accepted on the contract and listed there to appear as a swap option.

Local tests run against an Anvil mainnet fork so the script can use live v4 pool liquidity. Sepolia uses the Sepolia Universal Router, Quoter, and test-token pools in that same config file.

## MultiBaas

On Sepolia, invoice and accepted-token lists are read from MultiBaas event queries, not `eth_getLogs`. The contract is registered as the address alias `invoicecontract1`.

- `InvoiceCreated`, plus `InvoicePaid`, `InvoiceCancelled`, and `InvoiceExpired`, rebuild each invoice and its stored status.
- `AcceptedTokenSet` rebuilds the allow-list. The latest event per token wins.

The browser calls `/api/invoices` and `/api/accepted-tokens`. `MULTIBAAS_BASE_URL` and `MULTIBAAS_API_KEY` stay on the server. Other chains still replay logs from the configured RPC. Swap pool parameters are not indexed in MultiBaas; they stay in `config.ts`.
