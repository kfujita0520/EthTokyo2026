import { Contract, type EventLog } from "ethers";
import { assertInvoiceContractDeployed, getReadOnlyContract } from "./contract";
import { DEFAULT_FROM_BLOCK } from "./invoices";
import { isSepoliaRpc } from "./rpcChain";
import { getSwapConfig } from "./swap/config";

const ERC20_META_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

export interface AcceptedToken {
  address: string;
  symbol: string;
  decimals: number;
}

async function withMetadata(addresses: string[], chainId: number | null): Promise<AcceptedToken[]> {
  const contract = getReadOnlyContract();
  const swapTokens = getSwapConfig(chainId)?.tokens ?? [];
  const provider = contract.runner;
  return Promise.all(
    addresses.map(async (address) => {
      const fromConfig = swapTokens.find((t) => t.address.toLowerCase() === address.toLowerCase());
      if (fromConfig) {
        return { address: fromConfig.address, symbol: fromConfig.symbol, decimals: fromConfig.decimals };
      }
      try {
        const erc20 = new Contract(address, ERC20_META_ABI, provider);
        const [symbol, decimals] = await Promise.all([erc20.symbol(), erc20.decimals()]);
        return { address, symbol: String(symbol), decimals: Number(decimals) };
      } catch {
        return { address, symbol: `${address.slice(0, 6)}…${address.slice(-4)}`, decimals: 18 };
      }
    })
  );
}

/** Sepolia allow-list comes from MultiBaas AcceptedTokenSet events. */
async function fetchSepoliaAcceptedTokens(chainId: number | null): Promise<AcceptedToken[]> {
  const res = await fetch("/api/accepted-tokens");
  const body = (await res.json()) as { tokens?: Array<{ address: string }>; error?: string };
  if (!res.ok) throw new Error(body.error ?? `Accepted token list failed (${res.status})`);
  return withMetadata((body.tokens ?? []).map((token) => token.address), chainId);
}

/**
 * Current accepted-token set. On Sepolia this reads MultiBaas. Elsewhere it replays
 * AcceptedTokenSet logs and confirms each address with acceptedTokens().
 */
export async function fetchAcceptedTokens(
  chainId: number | null,
  fromBlock: number | "earliest" = DEFAULT_FROM_BLOCK
): Promise<AcceptedToken[]> {
  if (await isSepoliaRpc()) return fetchSepoliaAcceptedTokens(chainId);

  await assertInvoiceContractDeployed();
  const contract = getReadOnlyContract();
  const logs = (await contract.queryFilter(contract.filters.AcceptedTokenSet(), fromBlock)) as EventLog[];

  const latest = new Map<string, boolean>();
  for (const log of logs) {
    latest.set(String(log.args.token).toLowerCase(), Boolean(log.args.accepted));
  }

  const stillAccepted = (
    await Promise.all(
      [...latest.entries()]
        .filter(([, accepted]) => accepted)
        .map(async ([address]) => ((await contract.acceptedTokens(address)) ? address : null))
    )
  ).filter((address): address is string => address != null);

  return withMetadata(stillAccepted, chainId);
}
