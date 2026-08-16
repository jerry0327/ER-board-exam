import type { Metadata, Viewport } from "next";
import AppErrorBoundary from "./components/app-error-boundary";
import AudioPlayerProvider from "./components/audio-player-provider";
import AudioSectionCompanion from "./components/audio-section-companion";
import { THEME_INIT_SCRIPT } from "./lib/theme";
import "./site.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const title = "急專補給站｜急診專科題庫、指引與音檔";
const description = "整合民國 94–115 年（2005–2026）共 3,320 題急診專科歷屆選擇題、Tintinalli 9e、Rosen’s 10e 與 Goldfrank 11e 學習指引、學習音檔、詳解閱讀、錯題複習與備考工具。";

export const metadata: Metadata = {
  applicationName: "急專補給站",
  metadataBase: new URL("https://emergency-board-questions.jerry3627613.chatgpt.site"),
  title: {
    default: title,
    template: "%s｜急專補給站",
  },
  description,
  manifest: "/site.webmanifest",
  icons: {
    icon: [
      { url: "/brand/jizhuan-rosc-icon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/brand/jizhuan-rosc-icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/jizhuan-rosc-icon-48.png", sizes: "48x48", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "急專補給站",
  },
  openGraph: {
    type: "website",
    siteName: "急專補給站",
    locale: "zh_TW",
    title,
    description,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "急專補給站：急診專科題庫、學習指引與音檔" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
      <head>
        <meta name="color-scheme" content="light dark" />
        <meta id="app-theme-color" name="theme-color" content="#f1ede4" />
        <link rel="preload" href="/data/manifest.json" as="fetch" crossOrigin="anonymous" />
        <link rel="preload" href="/data/startup-index.json" as="fetch" crossOrigin="anonymous" />
        <script id="theme-init" dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <AppErrorBoundary>
          <AudioPlayerProvider>
            <AudioSectionCompanion />
            {children}
          </AudioPlayerProvider>
        </AppErrorBoundary>
      </body>
    </html>
  );
}
