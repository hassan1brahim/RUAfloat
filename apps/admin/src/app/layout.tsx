import type { Metadata } from "next";
import "leaflet/dist/leaflet.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Redbridge Admin — Flood Command",
  description: "HackRU-26 admin/dispatch view: live flood predictions, detections, and manual dispatch signaling.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
