import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import SOSAlertModal from '@/components/SOSAlertModal';
import AdminAlerts from '@/components/AdminAlerts';
import AppShell from '@/components/shell/AppShell';
import FetchInterceptor from '@/components/FetchInterceptor';
import AdminSocketProvider from '@/components/AdminSocketProvider';
import { ThemeProvider, THEME_INIT_SCRIPT } from '@/components/ui/Theme';
import { ToastProvider } from '@/components/ui/Toast';
import { ConfirmProvider } from '@/components/ui/Overlay';

// Geist ships with the repo (no font request at build or run time).
const geistSans = localFont({ src: "./fonts/GeistVF.woff", variable: "--font-sans", weight: "100 900", display: "swap" });
const geistMono = localFont({ src: "./fonts/GeistMonoVF.woff", variable: "--font-mono", weight: "100 900", display: "swap" });

export const metadata: Metadata = {
  title: "ZenWe Admin",
  description: "ZenWe operations admin: orders, stores, riders, campus services and customers.",
  // ZenWe logo (owner, 4 Nov 2026), from public/ (zenwe-* files; the older zenv-* files stay on disk, unused). The old favicon.ico is kept in assets/ (not served).
  icons: {
    icon: [{ url: "/zenwe-favicon-2026-11-04.png", type: "image/png", sizes: "64x64" }],
    apple: [{ url: "/zenwe-brand-badge-2026-11-04.png", type: "image/png", sizes: "512x512" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0d10" },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-IN" className={`${geistSans.variable} ${geistMono.variable}`} suppressHydrationWarning={true}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body suppressHydrationWarning={true}>
        <ThemeProvider>
          <ToastProvider>
            <ConfirmProvider>
              <AdminSocketProvider>
                <FetchInterceptor />
                <SOSAlertModal />
                {/* Server alerts (no rider for an order, SMS budget used up, money mismatches) */}
                <AdminAlerts />
                <AppShell>
                  {children}
                </AppShell>
              </AdminSocketProvider>
            </ConfirmProvider>
          </ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
