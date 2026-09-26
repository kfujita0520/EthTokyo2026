"use client";

import { useEffect, useState } from "react";
import { InvoiceCard } from "./InvoiceCard";
import { fetchAllInvoices, fetchInvoicesForPayer, type InvoiceView } from "@/lib/invoices";

export function InvoiceList({ payerFilter }: { payerFilter?: string }) {
  const [invoices, setInvoices] = useState<InvoiceView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInvoices(null);
    (async () => {
      try {
        const result = payerFilter ? await fetchInvoicesForPayer(payerFilter) : await fetchAllInvoices();
        if (!cancelled) setInvoices([...result].sort((a, b) => Number(b.id - a.id)));
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [payerFilter]);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!invoices) return <p className="text-sm text-neutral-500">Loading invoices…</p>;
  if (invoices.length === 0) return <p className="text-sm text-neutral-500">No invoices yet.</p>;

  return (
    <div className="space-y-3">
      {invoices.map((inv) => (
        <InvoiceCard key={inv.id.toString()} invoice={inv} />
      ))}
    </div>
  );
}
