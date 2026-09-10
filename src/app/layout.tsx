import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import { GeistPixelGrid } from "geist/font/pixel"
import "./globals.css"

export const metadata: Metadata = {
    // Required for Next to resolve the generated social card to an absolute URL.
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
    title: {
        default: "CivicFlow · Arkansas",
        template: "%s · CivicFlow",
    },
    description:
        "A planning simulator for Arkansas. Place growth and watch it travel through the road network, emergency response coverage and infrastructure cost, with every step open to inspection.",
    applicationName: "CivicFlow",
    keywords: [
        "Arkansas", "urban planning", "traffic simulation", "NFPA 1710",
        "Highway Capacity Manual", "2020 Census", "OpenStreetMap",
    ],
    openGraph: {
        type: "website",
        siteName: "CivicFlow",
        title: "CivicFlow · Arkansas",
        description:
            "Place growth in Arkansas and watch it travel through the road network, emergency response and infrastructure.",
    },
    twitter: {
        card: "summary_large_image",
        title: "CivicFlow · Arkansas",
        description:
            "Place growth in Arkansas and watch it travel through the road network, emergency response and infrastructure.",
    },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
    return (
        <html
            lang="en"
            className={`${GeistSans.variable} ${GeistMono.variable} ${GeistPixelGrid.variable}`}
        >
            <body>
                {/* Keyboard users should not have to tab the whole hero to reach
                    the page. First in the DOM, visible only when focused. */}
                <a
                    href="#main"
                    className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-accent focus:px-4 focus:py-2 focus:font-mono focus:text-[12px] focus:text-ink-950"
                >
                    Skip to content
                </a>
                {children}
                {/* Fixed grain. Digital flatness is the tell of a generated
                    interface; a little sensor noise gives the dark ground a
                    surface. Pointer-events off so it never intercepts a click. */}
                <div aria-hidden className="civic-grain" />
            </body>
        </html>
    )
}
