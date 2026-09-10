import Link from "next/link"

export const metadata = { title: "Not found" }

/**
 * A dead end should still tell you where you are and offer the two places worth
 * going. The default Next 404 does neither.
 */
export default function NotFound() {
    return (
        <main id="main" className="grid min-h-dvh place-content-center px-6 text-center">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-paper-400">
                404 · no such page
            </p>
            <h1 className="font-display mt-5 text-paper-100" style={{ fontSize: "clamp(38px, 6vw, 84px)" }}>
                Off the network
            </h1>
            <p className="mx-auto mt-4 max-w-sm text-[13px] leading-relaxed text-paper-300">
                Nothing is modelled at this address. The simulator covers Arkansas, Northwest
                Arkansas and Little Rock.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-5">
                <Link
                    href="/lab"
                    className="rounded bg-accent px-5 py-2.5 font-pixel text-[12px] tracking-[0.14em] text-ink-950 transition-opacity hover:opacity-90"
                >
                    OPEN THE LAB
                </Link>
                <Link href="/" className="font-mono text-[12px] text-paper-300 hover:text-paper-100">
                    back to the start
                </Link>
            </div>
        </main>
    )
}
