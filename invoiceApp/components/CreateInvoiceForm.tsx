"use client";

import { useEffect, useState, type FormEvent } from "react";
import { parseUnits, ZeroAddress, type EventLog } from "ethers";
import { useWallet } from "@/lib/wallet";
import { formatContractError, getReadOnlyContract, getWriteContract } from "@/lib/contract";
import { fetchAcceptedTokens, type AcceptedToken } from "@/lib/acceptedTokens";

export function CreateInvoiceForm({
  onCreated,
  tokenListKey = 0,
}: {
  onCreated?: (invoiceId: bigint) => void;
  tokenListKey?: number;
}) {
  const { signer, address, chainId } = useWallet();
  const [payer, setPayer] = useState("");
  const [token, setToken] = useState("");
  const [isEth, setIsEth] = useState(false);
  const [amount, setAmount] = useState("");
  const [decimals, setDecimals] = useState(18);
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptedTokens, setAcceptedTokens] = useState<AcceptedToken[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(true);
  const [merchant, setMerchant] = useState<string | null>(null);

  useEffect(() => {
    getReadOnlyContract()
      .merchant()
      .then(setMerchant)
      .catch(() => setMerchant(null));
  }, []);

  const isMerchant = Boolean(address && merchant && address.toLowerCase() === merchant.toLowerCase());

  useEffect(() => {
    let cancelled = false;
    setLoadingTokens(true);
    fetchAcceptedTokens(chainId)
      .then((tokens) => {
        if (cancelled) return;
        setAcceptedTokens(tokens);
        setToken((current) => {
          if (tokens.some((t) => t.address.toLowerCase() === current.toLowerCase())) return current;
          return "";
        });
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message ?? String(err));
      })
      .finally(() => {
        if (!cancelled) setLoadingTokens(false);
      });
    return () => {
      cancelled = true;
    };
  }, [chainId, tokenListKey]);

  function selectToken(address: string) {
    setToken(address);
    const meta = acceptedTokens.find((t) => t.address.toLowerCase() === address.toLowerCase());
    if (meta) setDecimals(meta.decimals);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!signer) return;
    if (!isEth && !token) {
      setError("Select an accepted ERC-20, or create a native ETH invoice.");
      return;
    }
    if (!isMerchant) {
      setError(
        `Only the merchant can create invoices. Connected ${address?.slice(0, 6)}… — switch to ${merchant ? `${merchant.slice(0, 6)}…${merchant.slice(-4)}` : "Anvil account 0"}.`
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const contract = getWriteContract(signer);
      const tokenAddress = isEth ? ZeroAddress : token;
      const amountWei = parseUnits(amount || "0", decimals);
      const dueDateUnix = dueDate ? BigInt(Math.floor(new Date(dueDate).getTime() / 1000)) : 0n;
      const payerAddress = payer || ZeroAddress;

      const tx = await contract.createInvoice(payerAddress, tokenAddress, amountWei, dueDateUnix);
      const receipt = await tx.wait();

      const created = (receipt.logs as EventLog[])
        .map((log) => {
          try {
            return contract.interface.parseLog(log);
          } catch {
            return null;
          }
        })
        .find((parsed) => parsed?.name === "InvoiceCreated");

      if (created) onCreated?.(created.args.invoiceId as bigint);
      setAmount("");
      setPayer("");
    } catch (err: unknown) {
      const contract = signer ? getWriteContract(signer) : undefined;
      setError(formatContractError(err, contract));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-neutral-800 p-5">
      <h2 className="text-lg font-medium text-white">Create invoice</h2>
      {!isMerchant && address && (
        <p className="text-xs text-amber-400">
          Connect the merchant wallet (Anvil account 0) to create invoices.
        </p>
      )}

      <label className="block text-sm text-neutral-300">
        Payer address (optional — blank means anyone may pay)
        <input
          value={payer}
          onChange={(e) => setPayer(e.target.value)}
          placeholder="0x..."
          className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-white"
        />
      </label>

      <label className="flex items-center gap-2 text-sm text-neutral-300">
        <input type="checkbox" checked={isEth} onChange={(e) => setIsEth(e.target.checked)} />
        Native ETH invoice
      </label>

      {!isEth && (
        <label className="block text-sm text-neutral-300">
          ERC-20 token
          <select
            value={token}
            onChange={(e) => selectToken(e.target.value)}
            disabled={loadingTokens || acceptedTokens.length === 0}
            className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-white disabled:opacity-50"
          >
            <option value="">
              {loadingTokens
                ? "Loading accepted tokens…"
                : acceptedTokens.length === 0
                  ? "No accepted tokens — add one below"
                  : "Select a token…"}
            </option>
            {acceptedTokens.map((t) => (
              <option key={t.address} value={t.address}>
                {t.symbol} ({t.address.slice(0, 6)}…{t.address.slice(-4)})
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="grid grid-cols-2 gap-4">
        <label className="block text-sm text-neutral-300">
          Amount
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.0"
            className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-white"
          />
        </label>
        <label className="block text-sm text-neutral-300">
          Decimals
          <input
            type="number"
            value={decimals}
            onChange={(e) => setDecimals(Number(e.target.value))}
            readOnly={!isEth && Boolean(token)}
            className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-white"
          />
        </label>
      </div>

      <label className="block text-sm text-neutral-300">
        Due date (optional)
        <input
          type="datetime-local"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
          className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-white"
        />
      </label>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={submitting || !signer || !isMerchant || (!isEth && !token)}
        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {submitting ? "Creating…" : "Create invoice"}
      </button>
    </form>
  );
}
