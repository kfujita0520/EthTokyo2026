"use client";

import { useState } from "react";
import { CreateInvoiceForm } from "@/components/CreateInvoiceForm";
import { AcceptedTokensPanel } from "@/components/AcceptedTokensPanel";
import { InvoiceList } from "@/components/InvoiceList";

export default function MerchantPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [tokenListKey, setTokenListKey] = useState(0);

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold">Merchant dashboard</h1>
      <CreateInvoiceForm onCreated={() => setRefreshKey((k) => k + 1)} tokenListKey={tokenListKey} />
      <AcceptedTokensPanel onChanged={() => setTokenListKey((k) => k + 1)} />
      <div>
        <h2 className="mb-3 text-lg font-medium">All invoices</h2>
        <InvoiceList key={refreshKey} />
      </div>
    </div>
  );
}
