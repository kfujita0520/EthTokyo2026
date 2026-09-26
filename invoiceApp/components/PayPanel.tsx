"use client";

import { useEffect, useMemo, useState } from "react";
import { Contract, ZeroAddress } from "ethers";
import { useWallet } from "@/lib/wallet";
import { getWriteContract, RPC_URL } from "@/lib/contract";
import { getSwapConfig } from "@/lib/swap/config";
import { fetchAcceptedTokens } from "@/lib/acceptedTokens";
import { quoteExactOutputSingle, withSlippageBuffer } from "@/lib/swap/quote";
import { payInvoiceWithRouterSwap } from "@/lib/swap/payInvoiceWithRouterSwap";
import { isNativeEth } from "@/lib/format";
import type { InvoiceView } from "@/lib/invoices";

const ERC20_ABI = [
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

export function PayPanel({
  invoice,
  invoiceContractAddress,
  onPaid,
}: {
  invoice: InvoiceView;
  invoiceContractAddress: string;
  onPaid?: () => void;
}) {
  const { signer, address, chainId } = useWallet();
  const [mode, setMode] = useState<"exact" | "swap">("exact");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [paidLocally, setPaidLocally] = useState(false);
  const [selectedTokenIn, setSelectedTokenIn] = useState("");
  const [slippageBps, setSlippageBps] = useState(50); // 0.5%
  const [acceptedAddresses, setAcceptedAddresses] = useState<string[]>([]);

  useEffect(() => {
    setPaidLocally(false);
    setStatus(null);
    setError(null);
  }, [invoice.id]);

  const swapConfig = getSwapConfig(chainId);
  const swapTokens = useMemo(() => {
    const accepted = new Set(acceptedAddresses);
    return (swapConfig?.tokens ?? []).filter(
      (t) =>
        accepted.has(t.address.toLowerCase()) &&
        t.address.toLowerCase() !== invoice.token.toLowerCase()
    );
  }, [swapConfig, acceptedAddresses, invoice.token]);

  useEffect(() => {
    let cancelled = false;
    fetchAcceptedTokens(chainId)
      .then((tokens) => {
        if (!cancelled) setAcceptedAddresses(tokens.map((t) => t.address.toLowerCase()));
      })
      .catch(() => {
        if (!cancelled) setAcceptedAddresses([]);
      });
    return () => {
      cancelled = true;
    };
  }, [chainId]);
  const isPaid = invoice.status === "Paid" || paidLocally;
  const canPay =
    !isPaid &&
    invoice.status === "Pending" &&
    (invoice.payer === ZeroAddress || invoice.payer.toLowerCase() === address?.toLowerCase());

  function markPaid() {
    setPaidLocally(true);
    setStatus(null);
    onPaid?.();
  }

  async function payExact() {
    if (!signer) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const contract = getWriteContract(signer);
      if (isNativeEth(invoice.token)) {
        await (await contract.payInvoiceETH(invoice.id, { value: invoice.amount })).wait();
      } else {
        const erc20 = new Contract(invoice.token, ERC20_ABI, signer);
        const allowance: bigint = await erc20.allowance(await signer.getAddress(), invoiceContractAddress);
        if (allowance < invoice.amount) {
          await (await erc20.approve(invoiceContractAddress, invoice.amount)).wait();
        }
        await (await contract.payInvoiceERC20(invoice.id)).wait();
      }
      markPaid();
    } catch (err: any) {
      setError(err?.shortMessage ?? err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  async function paySwap() {
    if (!signer || !swapConfig) return;
    const token = swapTokens.find((t) => t.address.toLowerCase() === selectedTokenIn.toLowerCase());
    if (!token) {
      setError("Pick a token to pay with.");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const zeroForOne = token.address.toLowerCase() < invoice.token.toLowerCase();
      const poolKey = zeroForOne
        ? { currency0: token.address, currency1: invoice.token, fee: token.poolFee, tickSpacing: token.tickSpacing, hooks: token.hooks }
        : { currency0: invoice.token, currency1: token.address, fee: token.poolFee, tickSpacing: token.tickSpacing, hooks: token.hooks };

      setStatus("Fetching a quote…");
      const { amountIn } = await quoteExactOutputSingle({
        rpcUrl: RPC_URL,
        quoterAddress: swapConfig.quoter,
        poolKey,
        zeroForOne,
        amountOut: invoice.amount,
      });
      const maxAmountIn = withSlippageBuffer(amountIn, slippageBps);

      setStatus("Confirm the transaction in your wallet…");
      await payInvoiceWithRouterSwap({
        invoiceContractAddress,
        signer,
        invoiceId: invoice.id,
        tokenIn: token.address,
        tokenOut: invoice.token,
        amountOut: invoice.amount,
        amountInMaximum: maxAmountIn,
        poolKey,
        zeroForOne,
      });
      markPaid();
    } catch (err: any) {
      setError(err?.shortMessage ?? err?.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  if (isPaid) {
    return (
      <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-5 py-6 text-center">
        <p className="text-lg font-semibold text-emerald-400">Payment complete</p>
        <p className="mt-1 text-sm text-emerald-200/80">This invoice has been settled on-chain.</p>
      </div>
    );
  }

  if (!canPay) {
    return (
      <p className="text-sm text-neutral-500">
        This invoice can&apos;t be paid right now (status: {invoice.status}).
      </p>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-neutral-800 p-5">
      <div className="flex gap-2 text-sm">
        <button
          onClick={() => setMode("exact")}
          className={`rounded-lg px-3 py-1.5 ${
            mode === "exact" ? "bg-indigo-600 text-white" : "border border-neutral-700 text-neutral-300"
          }`}
        >
          Pay in invoice token
        </button>
        <button
          onClick={() => setMode("swap")}
          className={`rounded-lg px-3 py-1.5 ${
            mode === "swap" ? "bg-indigo-600 text-white" : "border border-neutral-700 text-neutral-300"
          }`}
        >
          Pay with a different token
        </button>
      </div>

      {mode === "exact" && (
        <button
          onClick={payExact}
          disabled={busy || !signer}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {busy ? "Processing…" : "Pay"}
        </button>
      )}

      {mode === "swap" && (
        <div className="space-y-3">
          {!swapConfig && (
            <p className="text-sm text-amber-400">No swap config for this chain — see lib/swap/config.ts.</p>
          )}
          {swapConfig && (
            <>
              <select
                value={selectedTokenIn}
                onChange={(e) => setSelectedTokenIn(e.target.value)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-white"
              >
                <option value="">Select a token…</option>
                {swapTokens.length === 0 && (
                  <option value="" disabled>
                    No accepted tokens with swap config
                  </option>
                )}
                {swapTokens.map((t) => (
                  <option key={t.address} value={t.address}>
                    {t.symbol}
                  </option>
                ))}
              </select>
              <label className="block text-sm text-neutral-300">
                Slippage tolerance (bps, 50 = 0.5%)
                <input
                  type="number"
                  value={slippageBps}
                  onChange={(e) => setSlippageBps(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-white"
                />
              </label>
              <button
                onClick={paySwap}
                disabled={busy || !signer || !selectedTokenIn}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm text-white disabled:opacity-50"
              >
                {busy ? "Processing…" : "Swap & pay"}
              </button>
            </>
          )}
        </div>
      )}

      {status && <p className="text-sm text-neutral-300">{status}</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
