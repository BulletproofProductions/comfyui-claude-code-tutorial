import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import type { Metadata } from "next";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "ComfyUI Image Generator",
    template: "%s | ComfyUI Image Generator",
  },
  description:
    "AI-powered image generation using ComfyUI. Create stunning images with text-to-image and image-to-image capabilities, customizable prompts, and reusable avatars.",
  keywords: [
    "AI Image Generation",
    "ComfyUI",
    "Text to Image",
    "Image Generation",
    "ComfyUI Image Generator",
    "Next.js",
    "React",
  ],
  authors: [{ name: "ComfyUI Image Generator" }],
  creator: "ComfyUI Image Generator",
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: "ComfyUI Image Generator",
    title: "ComfyUI Image Generator",
    description:
      "AI-powered image generation using ComfyUI. Create stunning images with customizable prompts.",
  },
  twitter: {
    card: "summary_large_image",
    title: "ComfyUI Image Generator",
    description:
      "AI-powered image generation using ComfyUI. Create stunning images with customizable prompts.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

// JSON-LD structured data for SEO
const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "ComfyUI Image Generator",
  description:
    "AI-powered image generation using ComfyUI. Create stunning images with text-to-image and image-to-image capabilities.",
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Any",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  author: {
    "@type": "Organization",
    name: "ComfyUI Image Generator",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <SiteHeader />
          <main id="main-content">{children}</main>
          <SiteFooter />
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
