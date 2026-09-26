"use client";

import { useEffect, useState } from "react";
import { getAddress, ZeroAddress } from "ethers";
import { useWallet } from "@/lib/wallet";
import { formatContractError, getWriteContract, getReadOnlyContract } from "@/lib/contract";

export function AcceptedTokensPanel({ onChanged }: { onChanged?: () => void }) {
  const { signer, address, chainId } = useWallet();
  const [token, setToken] = useState("");
  const [accepted, setAccepted] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [merchant, setMerchant] = useState<string | null>(null);

  useEffect(() => {
    getReadOnlyContract()
      .merchant()
      .then(setMerchant)
      .catch(() => setMerchant(null));
  }, []);

  const isMerchant = Boolean(address && merchant && address.toLowerCase() === merchant.toLowerCase());

  function parseToken(): string {
    return getAddress(token.trim());
  }

  async function check() {
    setError(null);
    try {
      const parsed = parseToken();
      const contract = getReadOnlyContract();
      setAccepted(await contract.acceptedTokens(parsed));
    } catch (err: any) {
      setError(err?.code === "INVALID_ARGUMENT" ? "Enter a valid token address." : formatContractError(err));
    }
  }

  async function setAcceptedOnChain(next: boolean) {
    if (!signer || !address) return;
    setBusy(true);
    setError(null);
    try {
      const parsed = parseToken();
      if (parsed === ZeroAddress) {
        setError("Native ETH is not on this list — create ETH invoices with the checkbox above.");
        return;
      }
      if (chainId != null && chainId !== 31337 && chainId !== 1) {
        setError(`Wallet is on chain ${chainId}. Switch MetaMask to Localhost 31337.`);
        return;
      }
      if (!isMerchant) {
        setError(
          `Only the merchant can accept tokens. Connected ${address.slice(0, 6)}… — switch to ${merchant ? `${merchant.slice(0, 6)}…${merchant.slice(-4)}` : "Anvil account 0"}.`
        );
        return;
      }
      const contract = getWriteContract(signer);
      await (await contract.setAcceptedToken(parsed, next)).wait();
      setAccepted(next);
      onChanged?.();
    } catch (err: any) {
      if (err?.code === "INVALID_ARGUMENT") {
        setError("Enter a valid token address.");
      } else {
        const contract = signer ? getWriteContract(signer) : undefined;
        setError(formatContractError(err, contract));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-neutral-800 p-5">
      <h2 className="text-lg font-medium text-white">Accepted tokens</h2>
      <p className="text-xs text-neutral-500">
        One on-chain allow-list (`acceptedTokens`) for both invoice settlement tokens and
        swap-payment tokenIn. Native ETH is not listed here. For the payer swap dropdown,
        also add pool metadata in lib/swap/config.ts.
      </p>
      {!isMerchant && address && (
        <p className="text-xs text-amber-400">
          Connect the merchant wallet (Anvil account 0) to Accept or Revoke.
        </p>
      )}
      <div className="flex gap-2">
        <input
          value={token}
          onChange={(e) => {
            setToken(e.target.value);
            setAccepted(null);
          }}
          placeholder="Token address 0x..."
          className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-white"
        />
        <button onClick={check} className="rounded-lg border border-neutral-700 px-3 py-2 text-sm text-neutral-200">
          Check
        </button>
      </div>
      {accepted !== null && (
        <p className="text-sm text-neutral-300">
          Currently:{" "}
          <span className={accepted ? "text-emerald-400" : "text-red-400"}>
            {accepted ? "accepted" : "not accepted"}
          </span>
        </p>
      )}
      <div className="flex gap-2">
        <button
          onClick={() => setAcceptedOnChain(true)}
          disabled={busy || !token || !signer}
          className="rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          Accept
        </button>
        <button
          onClick={() => setAcceptedOnChain(false)}
          disabled={busy || !token || !signer}
          className="rounded-lg bg-red-600 px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          Revoke
        </button>
      </div>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
