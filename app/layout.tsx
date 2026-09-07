import type { Metadata, Viewport } from "next";
import { DM_Sans, Inter_Tight } from "next/font/google";
import "./globals.css";

/**
 * Clear Signal's two faces (docs/DESIGN.md): Inter Tight for headings and the
 * wordmark, DM Sans for reading and controls. Both were named in the tokens
 * from the start but never actually loaded, so every screen fell back to
 * `system-ui` and the approved typography never shipped. Each is a variable
 * font, so one file per family covers every weight the interface uses
 * (400/500 for body and labels, 600/700 for display) without a second request.
 *
 * `next/font` self-hosts the files and generates a metric-compatible fallback,
 * so there is no external request at runtime and no reflow when the real face
 * arrives. The CSS variables declared here are consumed by `--font-display`
 * and `--font-body` in `globals.css`; both token names are unchanged.
 */
const interTight = Inter_Tight({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display-face",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-body-face",
});

export const metadata: Metadata = {
  title: "FoodProof",
  description:
    "Document a food-label concern, prepare a complaint, and give the community a clearer picture. FoodProof complements official complaint portals; it does not file complaints or certify safety.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${interTight.variable} ${dmSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
