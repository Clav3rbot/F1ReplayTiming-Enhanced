import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import AuthGate from "@/components/AuthGate";
import CopyProtection from "@/components/CopyProtection";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "F1 Replay Timing",
  description: "Formula 1 race replay and telemetry visualization",
  icons: {
    icon: "/favicon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="bg-f1-dark text-f1-text font-sans selection:bg-f1-red/30 selection:text-white antialiased">
        <CopyProtection />
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}

