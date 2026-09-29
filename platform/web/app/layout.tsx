import type { Metadata, Viewport } from "next";
import { Playfair_Display } from "next/font/google";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
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
  // Один тег без media: цвет рамки ведёт выбранная тема, его правит THEME_INIT_SCRIPT и lib/theme.ts.
  themeColor: BRAND_COLORS.paper,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning — data-theme на <html> появляется до гидратации, из скрипта ниже.
    <html lang="ru" className={`${playfair.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full font-sans">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {children}
      </body>
    </html>
  );
}
