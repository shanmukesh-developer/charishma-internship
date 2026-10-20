import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import SOSAlertModal from '@/components/SOSAlertModal';
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
  title: "Zenvy Admin",
  description: "Zenvy operations admin: orders, stores, riders, campus services and customers.",
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
