import { Contract, Interface, JsonRpcProvider, type Signer } from "ethers";
import { INVOICE_CONTRACT_ABI } from "./abi/InvoiceContract";

export const INVOICE_CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_INVOICE_CONTRACT_ADDRESS ?? "";
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "";

if (typeof window !== "undefined" && !INVOICE_CONTRACT_ADDRESS) {
  // eslint-disable-next-line no-console
  console.warn("NEXT_PUBLIC_INVOICE_CONTRACT_ADDRESS is not set — see .env.local.example");
}

/** Read-only instance, backed by NEXT_PUBLIC_RPC_URL. Safe to call from anywhere. */
export function getReadOnlyContract(): Contract {
  const provider = new JsonRpcProvider(RPC_URL);
  return new Contract(INVOICE_CONTRACT_ADDRESS, INVOICE_CONTRACT_ABI, provider);
}

/** Empty bytecode at the configured address usually means a stale .env after re-seed. */
export async function assertInvoiceContractDeployed(): Promise<void> {
  const provider = new JsonRpcProvider(RPC_URL);
  const code = await provider.getCode(INVOICE_CONTRACT_ADDRESS);
  if (!code || code === "0x") {
    throw new Error(
      `No InvoiceContract at ${INVOICE_CONTRACT_ADDRESS}. After seed, set NEXT_PUBLIC_INVOICE_CONTRACT_ADDRESS to the logged address and restart npm run dev.`
    );
  }
}

/** Write-capable instance, backed by the connected wallet's signer. */
export function getWriteContract(signer: Signer): Contract {
  return new Contract(INVOICE_CONTRACT_ADDRESS, INVOICE_CONTRACT_ABI, signer);
}

const ERROR_COPY: Record<string, string> = {
  NotAuthorized: "Only the contract merchant can do this. Switch MetaMask to the merchant wallet.",
  UnsupportedToken: "Native ETH cannot be added to this list.",
  TokenNotAccepted: "This token is not on the accepted-token list.",
  InvalidAmount: "Amount must be greater than zero.",
};

const INVOICE_ERRORS = new Interface(INVOICE_CONTRACT_ABI);

function decodeCustomError(data: string, iface?: Interface): string | null {
  if (!data.startsWith("0x") || data.length < 10) return null;
  for (const candidate of [iface, INVOICE_ERRORS]) {
    if (!candidate) continue;
    try {
      const parsed = candidate.parseError(data);
      if (parsed) return ERROR_COPY[parsed.name] ?? parsed.name;
    } catch {
      // try the next interface
    }
  }
  return null;
}

/** Decode InvoiceContract custom errors; ethers often reports them as "unknown custom error". */
export function formatContractError(err: unknown, contract?: Contract): string {
  const anyErr = err as any;
  const blobs = [anyErr?.data, anyErr?.error?.data, anyErr?.info?.error?.data, anyErr?.info?.payload?.result];
  for (const blob of blobs) {
    if (typeof blob === "string") {
      const decoded = decodeCustomError(blob, contract?.interface);
      if (decoded) return decoded;
    }
  }

  const message: string = anyErr?.shortMessage ?? anyErr?.message ?? String(err);
  const selector = message.match(/custom error (0x[0-9a-fA-F]{8})/)?.[1];
  if (selector) {
    const decoded = decodeCustomError(selector);
    if (decoded) return decoded;
  }
  if (message.includes("unknown custom error") || message.includes("execution reverted")) {
    return `${message} — createInvoice / setAcceptedToken are merchant-only. Switch MetaMask to the merchant wallet on the same chain as NEXT_PUBLIC_RPC_URL.`;
  }
  return message;
}
