# Invoice App

Next.js UI for `InvoiceContract` (one deployment per merchant). Merchants create
invoices; payers settle in the invoice token (ETH or ERC-20) or swap an accepted
ERC-20 via Uniswap v4 Universal Router in the same transaction.

Contract design (why swap-and-pay is on-chain, trust model) is in
`evm_contracts/README.md`.

## Stack

- Next.js 14 (App Router), TypeScript, Tailwind
- ethers v6 (`window.ethereum`; no wagmi/viem)
- `@uniswap/v4-sdk` + `@uniswap/universal-router-sdk` for swap calldata

## Local setup (Anvil mainnet fork)

1. Start Anvil with a **fork URL**. The app must **not** talk to that URL
   directly — some hosted RPCs cap `eth_getLogs` at a short block range.

   ```bash
   anvil --fork-url "<your-fork-rpc>" --chain-id 31337
   ```

2. Seed from `evm_contracts` against `http://127.0.0.1:8545`,
   broadcasting as Anvil account 0 (merchant). Use the account-0 key from
   Anvil's startup banner; do not commit keys.

   Account 0 is merchant. The seed script Accepts USDC / USDT / JPYC and
   creates three ETH invoices. Payer 1 (account 1) is funded with those tokens
   via v4 swaps.

3. Set `invoiceApp/.env` (`NEXT_PUBLIC_RPC_URL`,
   `NEXT_PUBLIC_INVOICE_CONTRACT_ADDRESS`, `NEXT_PUBLIC_FROM_BLOCK`) from the
   seed logs, then restart `npm run dev`. The app RPC should stay the local
   Anvil endpoint, not the fork provider.

   The invoice contract address is generated using CREATE2, so the address can remain consistent as long as the contract implementation remains unchanged.

4. MetaMask: Localhost 31337 → the same local Anvil RPC. After every Anvil
   restart, **Settings → Developer Tools → Delete activity and nonce data**. Activity can show Failed otherwise although transaction can be completed successfuly.

```bash
cd invoiceApp
npm install
npm run dev
```

## Sepolia

The same app works on Sepolia (11155111). Point `.env` at a Sepolia RPC, the
deployed `InvoiceContract`, and that deploy's block as `FROM_BLOCK`. Also set
server-only `MULTIBAAS_BASE_URL` and `MULTIBAAS_API_KEY` (alias
`invoicecontract1`). On Sepolia, invoice and accepted-token lists come from
MultiBaas; other chains still replay logs. Restart `npm run dev`. MetaMask
must be on Sepolia.

`lib/swap/config.ts` already has Sepolia Universal Router, Permit2, Quoter, and
test tokens (Circle Sepolia USDC; JPYC testnet). There is no official Tether
USDT on Sepolia. `poolFee` / `tickSpacing` must match a pool that exists on
Sepolia v4 or the quote will revert. Accept tokens on-chain after deploy —
the Sepolia script does not seed them.

## Roles

| Anvil account | Role | Can |
| --- | --- | --- |
| 0 | Merchant | `createInvoice`, `setAcceptedToken`, `cancelInvoice` |
| 1 | Payer 1 | Pay seed invoice 1 (and anyone-can-pay invoices); holds seeded USDC/USDT/JPYC |
| 2 | Payer 2 | Pay seed invoice 3 |

`/merchant` is not gated. A non-merchant can open it; writes revert
`NotAuthorized`. The form disables Create / Accept unless the connected wallet
is `merchant()`.

Seed invoices 1 and 3 are payer-restricted. Invoice 2 is `payer = address(0)`
(anyone). The Pay button is hidden unless `Pending` and (`payer == 0` or
connected address).

## What is on-chain vs `lib/swap/config.ts`

**On-chain (`acceptedTokens`)** is the allow-list for invoice ERC-20s and swap
`tokenIn`. Merchant updates it via `AcceptedTokensPanel`. ETH is not listed;
ETH invoices use `token = address(0)`.

**`lib/swap/config.ts`** is Uniswap **route metadata**, not the allow-list:

- Universal Router / Permit2 / Quoter addresses (mainnet reused on 31337; Sepolia is separate)
- Per-token `poolFee` / `tickSpacing` / `hooks` so the client can build a
  single-hop `SWAP_EXACT_OUT_SINGLE`

Adding a token in config does not Accept it. Accepting on-chain without config
shows the token on Create invoice (symbol/decimals from the ERC-20) but not in
the swap dropdown — InvoiceContract does not store PoolKeys; it only checks
swap **results**. UR / Permit2 also live on the contract and could be read
from there; Quoter and pool params cannot.

`PayPanel` swap options = `config.tokens ∩ acceptedTokens`, excluding the
invoice token.

## Payments

- **Pay in invoice token:** ETH → `payInvoiceETH`. ERC-20 → `approve` this
  contract if needed, then `payInvoiceERC20`. USDC reverts with a reason
  string if allowance/balance is short, not an empty revert.
- **Pay with a different token:** quote then `payInvoiceWithRouterSwap`. The
  v4 Quoter takes **one nested struct**
  (`quoteExactOutputSingle(((address,address,uint24,int24,address),bool,uint128,bytes))`).
  A flattened ABI hits the wrong selector and reverts with empty data
  (`unknown custom error` / `require(false)`). `hookData` must be empty
  (`0x`), not `0x00`. ETH invoices can be paid by swapping an accepted ERC-20
  to native ETH.

After a successful pay, Pay buttons are replaced by a **Payment complete**
banner; the page Status updates to Paid without a refresh.

## Other UI / RPC notes

- Wallet address is persisted (`localStorage` + `eth_accounts`) so refresh /
  invoice navigation does not drop the connection. Empty `accountsChanged` is
  debounced so MetaMask flickers do not clear storage.
- Invoice lists replay `InvoiceCreated` from `NEXT_PUBLIC_FROM_BLOCK`. Wide
  `getLogs` against some hosted RPCs fails. Keep `FROM_BLOCK` near the deploy block.
  Enumerating `nextInvoiceId` would be more robust and is not implemented.
- Custom errors (`NotAuthorized`, `TokenNotAccepted`, …) are decoded in
  `formatContractError`. ethers often shows them as `unknown custom error`
  until decoded.

## Layout

- `lib/contract.ts` — read/write `Contract`, deploy check, error copy
- `lib/invoices.ts` / `lib/acceptedTokens.ts` — event + mapping reads
- `lib/wallet.tsx` — connect / persist
- `lib/swap/*` — quote, route plan, config
- `app/merchant` — create invoice, accepted tokens, full list
- `app/invoice/[id]` — pay / payment-complete


## Still open

- Invoice list via `nextInvoiceId` instead of wide `getLogs`
- Optional: read UR / Permit2 from the contract instead of duplicating them
  in `config.ts`
- MultiBaas (or other indexer) instead of client-side log replay
