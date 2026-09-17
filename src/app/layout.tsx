import type { Metadata } from "next";
import { Jost, Outfit } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

const displayFont = Jost({ subsets: ["latin"], variable: "--font-display", display: "swap" });
const bodyFont = Outfit({ subsets: ["latin"], variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  title: "Acquired — Deal Pipeline",
  description: "Evidence-led SME acquisition sourcing and outreach",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{if(localStorage.getItem("acquired-theme")==="light")document.documentElement.dataset.theme="light"}catch{}` }} />
      </head>
      <body className={`${displayFont.variable} ${bodyFont.variable}`}>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
