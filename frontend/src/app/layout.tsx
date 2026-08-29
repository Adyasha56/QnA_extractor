import type { Metadata } from "next";
import { Figtree, Bricolage_Grotesque, Inter } from "next/font/google";
import "@/styles/globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";

const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
  display: "swap",
});

const bricolageGrotesque = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "VedaAI — AI Teacher's Toolkit",
  description: "Extract and map questions and answers from exam papers",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${figtree.variable} ${bricolageGrotesque.variable} ${inter.variable}`}
    >
      <head>
        {/* Satoshi isn't on Google Fonts, so it's loaded from Fontshare instead. */}
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap"
        />
      </head>
      <body className="font-sans">
        <TooltipProvider>{children}</TooltipProvider>
      </body>
    </html>
  );
}
