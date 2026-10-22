import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Invoice Scanner",
  description: "Scan supplier invoices with Gemini and push them to Zoho Books",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-zinc-200 dark:border-zinc-800">
          <div className="mx-auto flex h-14 w-full max-w-7xl items-center px-4 sm:px-6">
            <Link href="/" className="font-semibold tracking-tight">
              Invoice Scanner
            </Link>
            <nav className="ml-6 flex gap-4 text-sm text-zinc-600 dark:text-zinc-400">
              <Link href="/" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                Invoices
              </Link>
              <Link href="/suppliers" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                Suppliers
              </Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
