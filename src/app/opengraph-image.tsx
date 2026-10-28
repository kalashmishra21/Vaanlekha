import { ImageResponse } from "next/og";

export const alt = "Vaanlekha — Your store, understood by voice";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 72, background: "#13281d", color: "#f6efe2", fontFamily: "Georgia, serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 20, fontFamily: "Arial, sans-serif", fontSize: 27, fontWeight: 700 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 55, height: 55, border: "2px solid #ce9b65", borderRadius: 14, color: "#ce9b65" }}>V</div>
        Vaanlekha
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 86, lineHeight: 1.03 }}><span>Your store,</span><span>understood by voice.</span></div>
        <div style={{ fontFamily: "Arial, sans-serif", fontSize: 25, color: "#d2c6ae" }}>Inventory · Khata · Sales · Trusted actions</div>
      </div>
      <div style={{ width: "100%", height: 3, background: "#ce9b65" }} />
    </div>,
    size,
  );
}
