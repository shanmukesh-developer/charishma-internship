import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import SOSAlertModal from '@/components/SOSAlertModal';
import NexusLayoutClient from '@/components/NexusLayoutClient';
import FetchInterceptor from '@/components/FetchInterceptor';

const outfit = Outfit({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Zenvy Nexus | Command Center",
  description: "The operational heart of Zenvy campus delivery. Real-time telemetry, fleet management, and deep analytics.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning={true}>
      <body className={`${outfit.className} antialiased bg-[#0A0A0F] text-slate-200 selection:bg-blue-500/30`} suppressHydrationWarning={true}>
        <FetchInterceptor />
        <SOSAlertModal />
        
        {/* Cinematic Backdrop */}
        <div className="fixed inset-0 pointer-events-none z-0">
          <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-blue-600/10 blur-[120px] rounded-full animate-pulse-soft" />
          <div className="absolute bottom-[-10%] left-[-10%] w-[400px] h-[400px] bg-[#C9A84C]/5 blur-[100px] rounded-full animate-pulse-soft" />
          <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-[0.03] mix-blend-overlay" />
        </div>

        <NexusLayoutClient>
          {children}
        </NexusLayoutClient>
      </body>
    </html>
  );
}
