import type { Metadata, Viewport } from "next";
import "./globals.css";
import { OaPwaProvider } from "@/components/oa-pwa";

export const viewport: Viewport = { themeColor: "#0C79D8", width: "device-width", initialScale: 1 };

export const metadata: Metadata = {
  title: "OriginMind × ARTS Robotics 联合研发 OA",
  description: "面向联合研发项目的技术成果、采购、劳务报酬及保密协议审批与归档平台。",
  manifest: "/manifest.webmanifest",
  other: { "apple-mobile-web-app-capable": "yes" },
  appleWebApp: { capable: true, title: "联合研发 OA", statusBarStyle: "default" },
  robots: {
    index: false,
    follow: false,
    noarchive: true,
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/pwa/apple-touch-icon-180-v2.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased"><OaPwaProvider>{children}</OaPwaProvider></body>
    </html>
  );
}
