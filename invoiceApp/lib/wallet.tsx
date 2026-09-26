"use client";

import { BrowserProvider, JsonRpcSigner } from "ethers";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

interface WalletState {
  address: string | null;
  chainId: number | null;
  signer: JsonRpcSigner | null;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletState | null>(null);
const STORAGE_KEY = "invoice-app:wallet";

type Persisted = { address: string; chainId: number | null };

type Snapshot = {
  address: string | null;
  chainId: number | null;
  signer: JsonRpcSigner | null;
  connecting: boolean;
};

const empty: Snapshot = { address: null, chainId: null, signer: null, connecting: false };
let snapshot: Snapshot = { ...empty };
const subscribers = new Set<() => void>();
let eventsBound = false;
let emptyAccountsTimer: number | undefined;

function emit() {
  subscribers.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

function getServerSnapshot() {
  return empty;
}

function readPersisted(): Persisted | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Persisted;
    return parsed?.address ? parsed : null;
  } catch {
    return null;
  }
}

function persist(address: string, chainId: number | null) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ address, chainId }));
}

function setSnapshot(patch: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...patch };
  if (snapshot.address) persist(snapshot.address, snapshot.chainId);
  emit();
}

function getInjectedProvider(): any {
  if (typeof window === "undefined") return null;
  return (window as any).ethereum ?? null;
}

if (typeof window !== "undefined") {
  const persisted = readPersisted();
  if (persisted) {
    snapshot = { ...snapshot, address: persisted.address, chainId: persisted.chainId };
  }
}

async function applySession(requestAccounts: boolean): Promise<boolean> {
  const injected = getInjectedProvider();
  if (!injected) return false;
  try {
    const provider = new BrowserProvider(injected);
    if (requestAccounts) {
      await provider.send("eth_requestAccounts", []);
    } else {
      const accounts: string[] = await provider.send("eth_accounts", []);
      if (!accounts.length) return false;
    }
    const newSigner = await provider.getSigner();
    const network = await provider.getNetwork();
    setSnapshot({
      signer: newSigner,
      address: await newSigner.getAddress(),
      chainId: Number(network.chainId),
    });
    return true;
  } catch {
    return false;
  }
}

function bindWalletEvents() {
  const injected = getInjectedProvider();
  if (!injected?.on || eventsBound) return;
  eventsBound = true;

  const onAccountsChanged = (accounts?: unknown) => {
    if (emptyAccountsTimer !== undefined) window.clearTimeout(emptyAccountsTimer);
    if (Array.isArray(accounts) && accounts.length === 0) {
      // Injected wallets often emit a transient empty list during Next.js navigations.
      emptyAccountsTimer = window.setTimeout(() => {
        void applySession(false);
      }, 400);
      return;
    }
    void applySession(false);
  };

  const onChainChanged = () => {
    if (snapshot.address || readPersisted()) void applySession(false);
  };

  injected.on("accountsChanged", onAccountsChanged);
  injected.on("chainChanged", onChainChanged);
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const { address, chainId, signer, connecting } = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );

  useEffect(() => {
    bindWalletEvents();
    const legacy = window.localStorage.getItem("invoice-app:wallet-connected") === "1";
    if (legacy || readPersisted() || snapshot.address) {
      void applySession(false).then((ok) => {
        if (ok) window.localStorage.removeItem("invoice-app:wallet-connected");
      });
    }

    const injectedLate = window.setInterval(() => {
      bindWalletEvents();
    }, 300);
    const stop = window.setTimeout(() => window.clearInterval(injectedLate), 3000);
    return () => {
      window.clearInterval(injectedLate);
      window.clearTimeout(stop);
    };
  }, []);

  const connect = useCallback(async () => {
    if (!getInjectedProvider()) {
      alert("No wallet found. Install MetaMask or another EIP-1193 wallet.");
      return;
    }
    setSnapshot({ connecting: true });
    try {
      await applySession(true);
    } finally {
      setSnapshot({ connecting: false });
    }
  }, []);

  const disconnect = useCallback(() => {
    if (typeof window !== "undefined") window.localStorage.removeItem(STORAGE_KEY);
    snapshot = { ...empty };
    emit();
  }, []);

  const value = useMemo(
    () => ({ address, chainId, signer, connecting, connect, disconnect }),
    [address, chainId, signer, connecting, connect, disconnect]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within <WalletProvider>");
  return ctx;
}
