import type { ReactNode } from "react";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Navbar } from "../components/navbar";
import { Footer } from "../components/footer";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "3moji",
  description: "A web address you can say out loud.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full">
      {/* `min-h-full`, not `h-full`: a fixed-height body stops painting its
          background at one viewport, and axe cannot decide the contrast of
          text that straddles that edge on a page taller than the screen (#196). */}
      <body
        className={`${inter.className} min-h-full flex flex-col bg-slate-50 antialiased`}
      >
        <div className="flex flex-1 flex-col">
          <Navbar />
          <div className="flex-1">{children}</div>
          <Footer />
        </div>
      </body>
    </html>
  );
}
