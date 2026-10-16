import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Cinque Ports FC Volunteer Rota", template: "%s · Cinque Ports FC Rota" },
  description: "Volunteer and venue rota for Cinque Ports FC: Marke Wood and Freemens Way.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2a426f",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <noscript>
          <p style={{ padding: 16, background: "#fff3cd", color: "#111827", fontWeight: 600 }}>
            The volunteer rota needs JavaScript. Please turn it on in your browser settings, or use a different browser.
          </p>
        </noscript>
        {children}
      </body>
    </html>
  );
}
