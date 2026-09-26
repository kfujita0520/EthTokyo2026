import { JsonRpcProvider } from "ethers";
import { RPC_URL } from "./contract";

/** Ethereum Sepolia. Lists on this chain come from MultiBaas, not eth_getLogs. */
export const SEPOLIA_CHAIN_ID = 11155111n;

let cachedChainId: Promise<bigint> | null = null;

/** Chain id of NEXT_PUBLIC_RPC_URL. Cached after the first successful lookup. */
export function configuredChainId(): Promise<bigint> {
  if (!cachedChainId) {
    const provider = new JsonRpcProvider(RPC_URL);
    cachedChainId = provider.getNetwork().then((network) => network.chainId).catch((err) => {
      cachedChainId = null;
      throw err;
    });
  }
  return cachedChainId;
}

export async function isSepoliaRpc(): Promise<boolean> {
  return (await configuredChainId()) === SEPOLIA_CHAIN_ID;
}
