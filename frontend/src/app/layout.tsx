import React from 'react';
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { CartProvider } from '@/context/CartContext';

import ToastProvider from '@/components/ToastProvider';
import VFXLayer from '@/components/VFXLayer';
import GlobalAnnouncement from '@/components/GlobalAnnouncement';
import FetchInterceptor from '@/components/FetchInterceptor';
import AntiInspect from '@/components/AntiInspect';

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
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <AntiInspect />
        <FetchInterceptor />
        <GlobalAnnouncement />
        <ToastProvider />
        <CartProvider>
          {/* Performance Optimized VFX Layer */}
          <VFXLayer />

          <div className="relative z-10">
            {children}
          </div>
        </CartProvider>
      </body>
    </html>
  );
}

