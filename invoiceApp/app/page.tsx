"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/lib/wallet";
import { getReadOnlyContract } from "@/lib/contract";
import { InvoiceList } from "@/components/InvoiceList";

export default function HomePage() {
  const { address, connect } = useWallet();
  const [merchant, setMerchant] = useState<string | null>(null);

  useEffect(() => {
    getReadOnlyContract()
      .merchant()
      .then(setMerchant)
      .catch(() => setMerchant(null));
  }, []);

  const isMerchant = Boolean(address && merchant && address.toLowerCase() === merchant.toLowerCase());

  if (!address) {
    return (
      <div className="space-y-4 text-center">
        <p className="text-neutral-400">Connect your wallet to view invoices.</p>
        <button
          onClick={connect}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Connect Wallet
        </button>
      </div>
    );
  }

  if (isMerchant) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">Merchant dashboard</h1>
          <Link href="/merchant" className="text-sm text-indigo-400 hover:underline">
            Manage invoices →
          </Link>
        </div>
        <InvoiceList />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Your invoices</h1>
      <InvoiceList payerFilter={address} />
    </div>
  );
}
