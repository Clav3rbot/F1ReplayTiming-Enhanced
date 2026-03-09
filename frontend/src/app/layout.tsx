import type { Metadata } from "next";
import "./globals.css";
import AuthGate from "@/components/AuthGate";

export const metadata: Metadata = {
  title: "F1 Replay Timing",
  description: "Formula 1 race replay and telemetry visualization",
  icons: {
    icon: "/favicon.png",
  },
  viewport: "width=device-width, initial-scale=1, viewport-fit=cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-f1-dark text-f1-text antialiased">
        <AuthGate>{children}</AuthGate>
      </body>
    </html>
  );
}
