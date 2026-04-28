import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Phloem -- AI Learning Companion",
  description:
    "A voice-first Socratic tutor for camera-captured learning material. Teach thinking, not just answers.",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg",
    apple: "/icon.svg"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
