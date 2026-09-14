import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { Navbar } from "../components/navbar";
import { Footer } from "../components/footer";
import { SiteAnalytics } from "../components/site-analytics";
import "./globals.css";

/**
 * The brand's three typefaces (#251), downloaded by `next/font` at build time
 * and served from this origin, so a page makes no request to Google and the
 * policy's `font-src 'self'` holds. Each is exposed as a CSS variable that the
 * `@theme inline` block in `globals.css` reads: `font-display`, `font-sans`
 * (the default) and `font-mono`.
 */
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-bricolage",
});
const sans = Geist({ subsets: ["latin"], variable: "--font-geist" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "3moji",
  description: "A web address you can say out loud.",
};

/**
 * **Every page renders per request** (#205, option 1, decided by the repo
 * owner). The Content Security Policy's nonce is generated per request in
 * `proxy.ts`, and Next.js can only put it on the scripts of a page it renders
 * for that request: a prerendered page carries no nonce, so under the policy
 * its scripts are refused and it never hydrates. This is why `/`, `/privacy`,
 * `/terms` and the 404 are no longer static.
 *
 * It is segment config, not a request read: the layout still calls no
 * `headers()` or `cookies()` (#193), and Next.js reads the nonce itself.
 */
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable} h-full`}
    >
      {/* `min-h-full`, not `h-full`: a fixed-height body stops painting its
          background at one viewport, and axe cannot decide the contrast of
          text that straddles that edge on a page taller than the screen (#196). */}
      <body className="min-h-full flex flex-col bg-paper font-sans text-ink antialiased">
        <div className="flex flex-1 flex-col">
          <Navbar />
          <div className="flex-1">{children}</div>
          <Footer />
        </div>
        <SiteAnalytics />
      </body>
    </html>
  );
}
