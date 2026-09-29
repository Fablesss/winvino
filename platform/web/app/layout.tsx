import type { Metadata, Viewport } from "next";
import { Playfair_Display } from "next/font/google";
import { APP_DESCRIPTION, APP_NAME, APP_TITLE, BRAND_COLORS } from "./brand";
import "./globals.css";

// Заголовочный шрифт vino-svoe.ru. Текст набирается системным шрифтом — там тоже system-ui.
const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin", "cyrillic"],
});

export const metadata: Metadata = {
  title: APP_TITLE,
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: BRAND_COLORS.paper },
    { media: "(prefers-color-scheme: dark)", color: BRAND_COLORS.paperDark },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru" className={`${playfair.variable} h-full antialiased`}>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
