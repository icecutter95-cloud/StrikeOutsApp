import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "StrikeOuts — MLB Pitcher K Props",
  description: "Model-driven MLB pitcher strikeout prop betting analysis"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-slate-900 text-slate-100">
        {/* Top Navigation */}
        <header className="sticky top-0 z-50 border-b border-slate-700 bg-slate-900/95 backdrop-blur">
          <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-2 text-xl font-bold tracking-tight">
              <span className="text-brand text-2xl">⚾</span>
              <span className="text-white">StrikeOuts</span>
            </Link>

            {/* Nav links */}
            <div className="flex items-center gap-6">
              <NavLink href="/">Dashboard</NavLink>
              <NavLink href="/history">History</NavLink>
              <NavLink href="/config">Config</NavLink>
            </div>
          </nav>
        </header>

        {/* Main content */}
        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>

        {/* Footer */}
        <footer className="border-t border-slate-800 py-6 text-center text-sm text-slate-500">
          <p>StrikeOuts v0.1 — For research and entertainment use only. Not financial advice.</p>
        </footer>
      </body>
    </html>
  );
}

function NavLink({
  href,
  children
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="text-sm font-medium text-slate-300 transition-colors hover:text-white"
    >
      {children}
    </Link>
  );
}
