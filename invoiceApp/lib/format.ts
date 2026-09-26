import { Contract, JsonRpcProvider, formatUnits, toUtf8String, ZeroAddress } from "ethers";
import { RPC_URL } from "./contract";

const STRING_SYMBOL_ABI = ["function symbol() view returns (string)"];
const BYTES32_SYMBOL_ABI = ["function symbol() view returns (bytes32)"];
const UINT8_DECIMALS_ABI = ["function decimals() view returns (uint8)"];
const UINT256_DECIMALS_ABI = ["function decimals() view returns (uint256)"];

const metaCache = new Map<string, Promise<{ symbol: string; decimals: number }>>();
let provider: JsonRpcProvider | null = null;

export function formatTokenAmount(amount: bigint, decimals = 18): string {
  return formatUnits(amount, decimals);
}

export function isNativeEth(token: string): boolean {
  return token.toLowerCase() === ZeroAddress.toLowerCase();
}

function readProvider(): JsonRpcProvider {
  if (!provider) provider = new JsonRpcProvider(RPC_URL);
  return provider;
}

/** Mainnet USDT returns symbol as bytes32, not string. */
function bytes32ToString(value: string): string {
  const stripped = value.replace(/^0x/, "").replace(/(00)+$/, "");
  if (!stripped) return "";
  return toUtf8String("0x" + stripped);
}

async function readSymbol(token: string): Promise<string> {
  const rpc = readProvider();
  try {
    const asString: string = await new Contract(token, STRING_SYMBOL_ABI, rpc).symbol();
    if (asString) return asString;
  } catch {
    // Fall through to the bytes32 form used by legacy tokens such as USDT.
  }
  const asBytes: string = await new Contract(token, BYTES32_SYMBOL_ABI, rpc).symbol();
  return bytes32ToString(asBytes);
}

async function readDecimals(token: string): Promise<number> {
  const rpc = readProvider();
  try {
    return Number(await new Contract(token, UINT8_DECIMALS_ABI, rpc).decimals());
  } catch {
    return Number(await new Contract(token, UINT256_DECIMALS_ABI, rpc).decimals());
  }
}

async function fetchTokenMeta(token: string): Promise<{ symbol: string; decimals: number }> {
  const [symbol, decimals] = await Promise.all([readSymbol(token), readDecimals(token)]);
  return { symbol, decimals };
}

export function getTokenMeta(token: string): Promise<{ symbol: string; decimals: number }> {
  if (isNativeEth(token)) return Promise.resolve({ symbol: "ETH", decimals: 18 });
  const key = token.toLowerCase();
  const cached = metaCache.get(key);
  if (cached) return cached;
  const pending = fetchTokenMeta(token);
  metaCache.set(key, pending);
  pending.catch(() => metaCache.delete(key));
  return pending;
}

/** Amount plus on-chain symbol, e.g. "250.0 USDC" or "0.5 ETH". */
export async function formatInvoiceAmount(token: string, amount: bigint): Promise<string> {
  const { symbol, decimals } = await getTokenMeta(token);
  return `${formatTokenAmount(amount, decimals)} ${symbol}`;
}

export function formatDueDate(dueDate: bigint): string {
  if (dueDate === 0n) return "No deadline";
  return new Date(Number(dueDate) * 1000).toLocaleString();
}
