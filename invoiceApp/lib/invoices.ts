import { ZeroAddress, type EventLog } from "ethers";
import { assertInvoiceContractDeployed, getReadOnlyContract } from "./contract";
import { INVOICE_STATUS_LABELS, type InvoiceStatusLabel } from "./abi/InvoiceContract";
import { isSepoliaRpc } from "./rpcChain";

export interface InvoiceView {
  id: bigint;
  payer: string;
  token: string;
  amount: bigint;
  dueDate: bigint;
  status: InvoiceStatusLabel;
}

function toInvoiceView(id: bigint, raw: any): InvoiceView {
  return {
    id,
    payer: raw.payer,
    token: raw.token,
    amount: raw.amount,
    dueDate: raw.dueDate,
    status: INVOICE_STATUS_LABELS[Number(raw.status)],
  };
}

export async function fetchInvoice(id: bigint): Promise<InvoiceView> {
  await assertInvoiceContractDeployed();
  const contract = getReadOnlyContract();
  const raw = await contract.getInvoice(id);
  return toInvoiceView(id, raw);
}

/**
 * Block where InvoiceContract was deployed on the configured chain.
 * Alchemy's free tier rejects eth_getLogs ranges wider than 10 blocks, so scanning
 * from genesis ("earliest") fails. Override with NEXT_PUBLIC_FROM_BLOCK after a new deploy.
 */
export const DEFAULT_FROM_BLOCK: number | "earliest" = process.env.NEXT_PUBLIC_FROM_BLOCK
  ? Number(process.env.NEXT_PUBLIC_FROM_BLOCK)
  : 26_054_833;

type InvoiceListItem = {
  id: string;
  payer: string;
  token: string;
  amount: string;
  dueDate: string;
  status: InvoiceStatusLabel;
};

function fromListItem(row: InvoiceListItem): InvoiceView {
  return {
    id: BigInt(row.id),
    payer: row.payer,
    token: row.token,
    amount: BigInt(row.amount),
    dueDate: BigInt(row.dueDate),
    status: row.status,
  };
}

/** Sepolia lists come from MultiBaas. Other chains replay InvoiceCreated logs. */
async function fetchSepoliaInvoices(payer?: string): Promise<InvoiceView[]> {
  const url = payer ? `/api/invoices?payer=${encodeURIComponent(payer)}` : "/api/invoices";
  const res = await fetch(url);
  const body = (await res.json()) as { invoices?: InvoiceListItem[]; error?: string };
  if (!res.ok) throw new Error(body.error ?? `Invoice list failed (${res.status})`);
  return (body.invoices ?? []).map(fromListItem);
}

/**
 * Enumerates invoices. On Sepolia this reads MultiBaas event queries. Elsewhere it
 * replays InvoiceCreated logs and loads each invoice with getInvoice.
 */
export async function fetchAllInvoices(fromBlock: number | "earliest" = DEFAULT_FROM_BLOCK): Promise<InvoiceView[]> {
  if (await isSepoliaRpc()) return fetchSepoliaInvoices();
  await assertInvoiceContractDeployed();
  const contract = getReadOnlyContract();
  const logs = (await contract.queryFilter(contract.filters.InvoiceCreated(), fromBlock)) as EventLog[];
  const ids = logs.map((log) => log.args.invoiceId as bigint);
  return Promise.all(ids.map((id) => fetchInvoice(id)));
}

export async function fetchInvoicesForPayer(
  payer: string,
  fromBlock: number | "earliest" = DEFAULT_FROM_BLOCK
): Promise<InvoiceView[]> {
  if (await isSepoliaRpc()) return fetchSepoliaInvoices(payer);
  const contract = getReadOnlyContract();
  const [own, open] = await Promise.all([
    contract.queryFilter(contract.filters.InvoiceCreated(null, null, payer), fromBlock) as Promise<EventLog[]>,
    contract.queryFilter(contract.filters.InvoiceCreated(null, null, ZeroAddress), fromBlock) as Promise<EventLog[]>,
  ]);
  const ids = [...own, ...open].map((log) => log.args.invoiceId as bigint);
  const uniqueIds = [...new Set(ids.map(String))].map(BigInt);
  return Promise.all(uniqueIds.map((id) => fetchInvoice(id)));
}
