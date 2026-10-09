import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Titillium_Web } from "next/font/google";
import "./globals.css";
import AuthGate from "@/components/AuthGate";
import CopyProtection from "@/components/CopyProtection";
import { ThemeSync } from "@/components/ThemeToggle";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

// F1's former broadcast typeface: the team radio card
const titillium = Titillium_Web({
  subsets: ["latin"],
  weight: ["600", "700"],
  style: ["normal", "italic"],
  variable: "--font-display",
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
    // The inline script adds the saved theme class before first paint;
    // suppressHydrationWarning covers that class differing from the server HTML.
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} ${titillium.variable}`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("theme")==="light")document.documentElement.classList.add("light")}catch(e){}`,
          }}
        />
      </head>
      <body className="bg-f1-dark text-f1-text font-sans selection:bg-f1-red/30 selection:text-ink antialiased">
        <ThemeSync />
        <CopyProtection />
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}

