import "./globals.css";
import type { ReactNode } from "react";
import Link from "next/link";
import { WalletProvider } from "@/lib/wallet";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";

export const metadata = {
  title: "Invoice App",
  description: "Pay and manage on-chain invoices, with optional Uniswap v4 auto-swap payments.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100">
        <WalletProvider>
          <header className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
            <Link href="/" className="text-lg font-semibold">
              Invoice App
            </Link>
            <ConnectWalletButton />
          </header>
          <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
        </WalletProvider>
      </body>
    </html>
  );
}
