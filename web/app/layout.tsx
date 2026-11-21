import type { Metadata, Viewport } from "next";
import "./globals.css";

// Japanese fonts ship as hundreds of unicode-range slices, so they're loaded by
// the browser from Google Fonts rather than bundled at build time.
const FONTS =
  "https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=Zen+Kaku+Gothic+New:wght@400;500;700&family=DotGothic16&display=swap";

export const metadata: Metadata = {
  title: "Lost in Japan — Lexical",
  description:
    "A voice-driven visual novel that teaches Japanese. Talk your way out of Narita with no passport, no phone and no money.",
};

export const viewport: Viewport = {
  themeColor: "#fdfcf3",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={FONTS} />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
