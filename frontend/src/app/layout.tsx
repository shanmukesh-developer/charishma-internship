import React from 'react';
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { CartProvider } from '@/context/CartContext';
import { WorldTransitionProvider } from '@/context/WorldTransitionContext';

import ToastProvider from '@/components/ToastProvider';
import VFXLayer from '@/components/VFXLayer';
import GlobalAnnouncement from '@/components/GlobalAnnouncement';
import FetchInterceptor from '@/components/FetchInterceptor';
import AntiInspect from '@/components/AntiInspect';
import WorldTransitionOverlay from '@/components/WorldTransitionOverlay';

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Zenvy — Food Delivery in Amaravathi",
  description: "Order food from the best restaurants in Amaravathi. Fast delivery, easy tracking, premium experience.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#0A0A0B"
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning={true}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                if (localStorage.theme === 'light' || (!('theme' in localStorage) && window.matchMedia('(prefers-color-scheme: light)').matches)) {
                  document.documentElement.classList.add('light');
                } else if (localStorage.theme === 'dark') {
                  document.documentElement.classList.remove('light');
                }
              } catch (e) {}
            `,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning={true}
      >
        <AntiInspect />
        <FetchInterceptor />
        <GlobalAnnouncement />
        <ToastProvider />
        <CartProvider>
          <WorldTransitionProvider>
            {/* Performance Optimized VFX Layer */}
            <VFXLayer />
            <WorldTransitionOverlay />

            <div className="relative z-10">
              {children}
            </div>
          </WorldTransitionProvider>
        </CartProvider>
      </body>
    </html>
  );
}
