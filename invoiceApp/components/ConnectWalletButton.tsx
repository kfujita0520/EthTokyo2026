"use client";

import { useWallet } from "@/lib/wallet";

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function ConnectWalletButton() {
  const { address, connecting, connect, disconnect } = useWallet();

  if (address) {
    return (
      <button
        onClick={disconnect}
        className="rounded-lg border border-neutral-700 px-3 py-1.5 text-sm text-neutral-200 hover:bg-neutral-800"
        title="Click to disconnect"
      >
        {short(address)}
      </button>
    );
  }

  return (
    <button
      onClick={connect}
      disabled={connecting}
      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
    >
      {connecting ? "Connecting…" : "Connect Wallet"}
    </button>
  );
}
