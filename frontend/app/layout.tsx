import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import "../styles/globals.css";

// Inter for the interface, JetBrains Mono for technical data, and Fraunces — a
// warm optical serif — for greetings/display, giving the calm editorial feel of
// a premium personal product. next/font self-hosts them.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-serif",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "Scout",
  description: "Scout — Personal Intelligence",
};

// Set the theme before first paint so there's no flash (stored choice → system → light).
// Nightfall is the identity — dark ships as the default for new users; the
// toggle still writes to localStorage so an explicit choice is respected.
const themeScript = `(function(){try{var t=localStorage.getItem('scout-theme');if(!t){t='dark';}document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable} ${jetbrainsMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
