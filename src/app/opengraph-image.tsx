import { ImageResponse } from "next/og"

/**
 * Social card, generated rather than shipped as a binary.
 *
 * It states the two figures the project stands on -- a counted population and a
 * modelled network -- because a link preview is the only thing most people will
 * ever see of it, and "a planning simulator" tells them nothing.
 */
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"
export const alt = "CivicFlow: a planning simulator for Arkansas"

export default function Image() {
    return new ImageResponse(
        (
            <div
                style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    background: "#06070a",
                    color: "#eef1f6",
                    padding: 80,
                    fontFamily: "monospace",
                }}
            >
                <div style={{ display: "flex", gap: 10, marginBottom: 28 }}>
                    <div style={{ width: 26, height: 26, background: "#6ea8fe" }} />
                    <div style={{ width: 26, height: 26, background: "#2a3140" }} />
                    <div style={{ width: 26, height: 26, background: "#2a3140" }} />
                    <div style={{ width: 26, height: 26, background: "#c96f4a" }} />
                </div>
                <div style={{ fontSize: 92, letterSpacing: -2, lineHeight: 1 }}>CIVICFLOW</div>
                <div style={{ fontSize: 34, color: "#98a2b3", marginTop: 26, lineHeight: 1.35 }}>
                    Place growth in Arkansas. Watch it travel through the road
                    network, emergency response and infrastructure.
                </div>
                <div style={{ display: "flex", gap: 44, marginTop: 52, fontSize: 22, color: "#6b7688" }}>
                    <div style={{ display: "flex" }}>3,011,524 residents · 2020 Census</div>
                    <div style={{ display: "flex" }}>30,148 modelled road edges</div>
                </div>
            </div>
        ),
        size,
    )
}
