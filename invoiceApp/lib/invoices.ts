import { ZeroAddress, type EventLog } from "ethers";
import { assertInvoiceContractDeployed, getReadOnlyContract } from "./contract";
import { INVOICE_STATUS_LABELS, type InvoiceStatusLabel } from "./abi/InvoiceContract";

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
 * Block where InvoiceContract was deployed on the current Anvil mainnet fork.
 * Alchemy's free tier rejects eth_getLogs ranges wider than 10 blocks, so scanning
 * from genesis ("earliest") fails. Override with NEXT_PUBLIC_FROM_BLOCK after a new deploy.
 */
export const DEFAULT_FROM_BLOCK: number | "earliest" = process.env.NEXT_PUBLIC_FROM_BLOCK
  ? Number(process.env.NEXT_PUBLIC_FROM_BLOCK)
  : 26_054_833;

/**
 * Enumerates invoices by replaying InvoiceCreated logs from the chain. This is fine for
 * a scaffold or low invoice volume, but does not scale well and depends on your RPC
 * provider's log-query limits.
 *
 * InvoiceContract.sol's own comments say InvoiceCreated / InvoicePaid are already wired
 * to MultiBaas webhooks — for production, prefer reading from whatever store those
 * webhooks populate (or MultiBaas's own event-indexing/query API) instead of replaying
 * logs client-side on every page load. Swap the body of these two functions for that
 * call when you wire it up; InvoiceView is deliberately provider-agnostic.
 */
export async function fetchAllInvoices(fromBlock: number | "earliest" = DEFAULT_FROM_BLOCK): Promise<InvoiceView[]> {
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
  const contract = getReadOnlyContract();
  const [own, open] = await Promise.all([
    contract.queryFilter(contract.filters.InvoiceCreated(null, null, payer), fromBlock) as Promise<EventLog[]>,
    contract.queryFilter(contract.filters.InvoiceCreated(null, null, ZeroAddress), fromBlock) as Promise<EventLog[]>,
  ]);
  const ids = [...own, ...open].map((log) => log.args.invoiceId as bigint);
  const uniqueIds = [...new Set(ids.map(String))].map(BigInt);
  return Promise.all(uniqueIds.map((id) => fetchInvoice(id)));
}
