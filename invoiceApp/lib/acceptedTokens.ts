import { Contract, type EventLog } from "ethers";
import { assertInvoiceContractDeployed, getReadOnlyContract } from "./contract";
import { DEFAULT_FROM_BLOCK } from "./invoices";
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

/**
 * Builds the current accepted-token set by replaying AcceptedTokenSet logs, then
 * confirming each address against acceptedTokens(). Mapping is not enumerable.
 */
export async function fetchAcceptedTokens(
  chainId: number | null,
  fromBlock: number | "earliest" = DEFAULT_FROM_BLOCK
): Promise<AcceptedToken[]> {
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

  const swapTokens = getSwapConfig(chainId)?.tokens ?? [];
  const provider = contract.runner;

  return Promise.all(
    stillAccepted.map(async (address) => {
      const fromConfig = swapTokens.find((t) => t.address.toLowerCase() === address);
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
