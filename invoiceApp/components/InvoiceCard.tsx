"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { InvoiceView } from "@/lib/invoices";
import type { InvoiceStatusLabel } from "@/lib/abi/InvoiceContract";
import { formatDueDate, formatInvoiceAmount } from "@/lib/format";

const STATUS_STYLES: Record<InvoiceStatusLabel, string> = {
  Pending: "bg-amber-500/15 text-amber-300",
  Paid: "bg-emerald-500/15 text-emerald-300",
  Cancelled: "bg-neutral-500/15 text-neutral-300",
  Expired: "bg-red-500/15 text-red-300",
};

export function InvoiceCard({ invoice }: { invoice: InvoiceView }) {
  const [amountLabel, setAmountLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    formatInvoiceAmount(invoice.token, invoice.amount)
      .then((label) => {
        if (!cancelled) setAmountLabel(label);
      })
      .catch(() => {
        if (!cancelled) setAmountLabel(null);
      });
    return () => {
      cancelled = true;
    };
  }, [invoice.token, invoice.amount]);

  return (
    <Link
      href={`/invoice/${invoice.id}`}
      className="flex items-center justify-between rounded-xl border border-neutral-800 p-4 transition hover:border-neutral-600"
    >
      <div>
        <p className="text-sm text-neutral-400">Invoice #{invoice.id.toString()}</p>
        <p className="text-lg font-medium text-white">
          {amountLabel ?? "…"}
        </p>
        <p className="text-xs text-neutral-500">Due: {formatDueDate(invoice.dueDate)}</p>
      </div>
      <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[invoice.status]}`}>
        {invoice.status}
      </span>
    </Link>
  );
}
