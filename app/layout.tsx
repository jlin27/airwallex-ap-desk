import type { Metadata } from "next";
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
  title: "AP Desk",
  description: "Review bill exceptions and validate safe payouts with Airwallex.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "AP Desk",
    description: "The agent reviews. The server verifies. Airwallex validates.",
    images: [
      {
        url: "/og-v2.png",
        width: 1730,
        height: 909,
        alt: "AP Desk bill exception review workspace",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AP Desk",
    description: "The agent reviews. The server verifies. Airwallex validates.",
    images: ["/og-v2.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
