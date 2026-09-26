import * as MultiBaas from "@curvegrid/multibaas-sdk";
import { getAddress, ZeroAddress } from "ethers";
import type { InvoiceStatusLabel } from "./abi/InvoiceContract";

const PAGE_SIZE = 50;
const MAX_PAGES = 25;

const CONTRACT_ALIAS = process.env.MULTIBAAS_CONTRACT_ALIAS || "invoicecontract1";

export type InvoiceListItem = {
  id: string;
  payer: string;
  token: string;
  amount: string;
  dueDate: string;
  status: InvoiceStatusLabel;
};

function createEventQueriesClient(): MultiBaas.EventQueriesApi {
  const baseUrl = process.env.MULTIBAAS_BASE_URL;
  const apiKey = process.env.MULTIBAAS_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error("Set MULTIBAAS_BASE_URL and MULTIBAAS_API_KEY to list Sepolia invoices.");
  }
  const config = new MultiBaas.Configuration({
    basePath: new URL("/api/v0", baseUrl).toString(),
    accessToken: apiKey,
  });
  return new MultiBaas.EventQueriesApi(config);
}

function contractFilter(): MultiBaas.EventQueryFilter {
  return {
    fieldType: "contract_address_alias",
    operator: "equal",
    value: CONTRACT_ALIAS,
  };
}

function queryError(err: unknown): Error {
  const response = (err as { response?: { data?: { message?: unknown } } }).response;
  const message = response?.data?.message;
  if (typeof message === "string" && message) return new Error(message);
  return err instanceof Error ? err : new Error(String(err));
}

async function queryAll(query: MultiBaas.EventQuery): Promise<Array<Record<string, unknown>>> {
  const api = createEventQueriesClient();
  const rows: Array<Record<string, unknown>> = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    let resp;
    try {
      resp = await api.executeArbitraryEventQuery(query, page * PAGE_SIZE, PAGE_SIZE);
    } catch (err) {
      throw queryError(err);
    }
    const batch = resp.data.result?.rows ?? [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

function asText(value: unknown): string {
  if (value == null) return "";
  return String(value);
}

function timeValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function asAccepted(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    return normalized === "true" || normalized === "1";
  }
  return false;
}

function statusFromEvent(name: string): InvoiceStatusLabel | null {
  if (name.includes("InvoicePaid")) return "Paid";
  if (name.includes("InvoiceCancelled")) return "Cancelled";
  if (name.includes("InvoiceExpired")) return "Expired";
  return null;
}

function statusEvent(eventName: string): MultiBaas.EventQueryEvent {
  return {
    eventName,
    select: [
      { type: "input", inputIndex: 0, alias: "invoiceId" },
      { type: "event_signature", alias: "eventName" },
      { type: "triggered_at", alias: "timestamp" },
    ],
    filter: contractFilter(),
  };
}

/** Latest AcceptedTokenSet per token, keeping addresses that are still accepted. */
export async function listAcceptedTokenAddresses(): Promise<Array<{ address: string }>> {
  const rows = await queryAll({
    events: [
      {
        eventName: "AcceptedTokenSet",
        select: [
          { type: "input", inputIndex: 0, alias: "token" },
          { type: "input", inputIndex: 1, alias: "accepted" },
          { type: "triggered_at", alias: "timestamp" },
        ],
        filter: contractFilter(),
      },
    ],
    orderBy: "timestamp",
    order: "DESC",
  });

  const seen = new Set<string>();
  const accepted: Array<{ address: string }> = [];
  const latestFirst = [...rows].sort((a, b) => timeValue(b.timestamp) - timeValue(a.timestamp));
  for (const row of latestFirst) {
    let address: string;
    try {
      address = getAddress(asText(row.token));
    } catch {
      continue;
    }
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (asAccepted(row.accepted)) accepted.push({ address });
  }
  return accepted;
}

/**
 * InvoiceCreated rows plus the latest InvoicePaid / InvoiceCancelled / InvoiceExpired
 * event. Stored status stays Pending until expireInvoice, so this matches getInvoice.
 */
export async function listInvoices(payer?: string | null): Promise<InvoiceListItem[]> {
  const [created, statusRows] = await Promise.all([
    queryAll({
      events: [
        {
          eventName: "InvoiceCreated",
          select: [
            { type: "input", inputIndex: 0, alias: "invoiceId" },
            { type: "input", inputIndex: 1, alias: "merchant" },
            { type: "input", inputIndex: 2, alias: "payer" },
            { type: "input", inputIndex: 3, alias: "token" },
            { type: "input", inputIndex: 4, alias: "amount" },
            { type: "input", inputIndex: 5, alias: "dueDate" },
            { type: "triggered_at", alias: "timestamp" },
          ],
          filter: contractFilter(),
        },
      ],
      orderBy: "timestamp",
      order: "DESC",
    }),
    queryAll({
      events: [statusEvent("InvoicePaid"), statusEvent("InvoiceCancelled"), statusEvent("InvoiceExpired")],
      orderBy: "timestamp",
      order: "DESC",
    }),
  ]);

  const statusById = new Map<string, { status: InvoiceStatusLabel; at: number }>();
  for (const row of statusRows) {
    const id = asText(row.invoiceId);
    const status = statusFromEvent(asText(row.eventName));
    if (!id || !status) continue;
    const at = timeValue(row.timestamp);
    const current = statusById.get(id);
    if (!current || at >= current.at) statusById.set(id, { status, at });
  }

  const want = payer?.toLowerCase();
  const invoices: InvoiceListItem[] = [];
  for (const row of created) {
    let payerAddress: string;
    let token: string;
    try {
      payerAddress = getAddress(asText(row.payer));
      token = getAddress(asText(row.token));
    } catch {
      continue;
    }
    if (want && payerAddress.toLowerCase() !== want && payerAddress.toLowerCase() !== ZeroAddress.toLowerCase()) {
      continue;
    }
    const id = asText(row.invoiceId);
    invoices.push({
      id,
      payer: payerAddress,
      token,
      amount: asText(row.amount),
      dueDate: asText(row.dueDate),
      status: statusById.get(id)?.status ?? "Pending",
    });
  }
  return invoices;
}
