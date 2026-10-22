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
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
