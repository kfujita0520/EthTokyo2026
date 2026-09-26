"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { fetchInvoice, type InvoiceView } from "@/lib/invoices";
import { formatDueDate, formatInvoiceAmount } from "@/lib/format";
import { PayPanel } from "@/components/PayPanel";
import { INVOICE_CONTRACT_ADDRESS } from "@/lib/contract";

export default function InvoicePage() {
  const params = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceView | null>(null);
  const [amountLabel, setAmountLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setInvoice(null);
    setAmountLabel(null);
    setError(null);
    fetchInvoice(BigInt(params.id))
      .then(async (next) => {
        const label = await formatInvoiceAmount(next.token, next.amount);
        if (cancelled) return;
        setInvoice(next);
        setAmountLabel(label);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [params.id]);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!invoice || amountLabel === null) return <p className="text-sm text-neutral-500">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-neutral-400">Invoice #{invoice.id.toString()}</p>
        <p className="text-2xl font-semibold">
          {amountLabel}
        </p>
        <p className="text-sm text-neutral-500">Due: {formatDueDate(invoice.dueDate)}</p>
        <p className={`text-sm ${invoice.status === "Paid" ? "font-medium text-emerald-400" : "text-neutral-500"}`}>
          Status: {invoice.status}
        </p>
      </div>
      <PayPanel
        invoice={invoice}
        invoiceContractAddress={INVOICE_CONTRACT_ADDRESS}
        onPaid={() => setInvoice((current) => (current ? { ...current, status: "Paid" } : current))}
      />
    </div>
  );
}
