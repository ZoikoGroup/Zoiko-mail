"use client";

// The root layout itself failed, so none of the app's styles or providers are
// there: this has to stand on its own, with inline styles.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#EEF2F5",
          color: "#14212B",
          textAlign: "center",
          padding: 16,
        }}
      >
        <div role="alert">
          {/* eslint-disable-next-line @next/next/no-img-element -- next/image needs the app that just failed */}
          <img src="/zoiko-icon.png" width={48} height={48} alt="" style={{ borderRadius: 11 }} />
          <h1 style={{ fontSize: 16, margin: "16px 0 4px" }}>Zoiko Mail didn&rsquo;t load</h1>
          <p style={{ fontSize: 14, color: "#6C8092", margin: "0 0 16px" }}>Something went wrong. Your data is safe.</p>
          <button
            type="button"
            onClick={() => reset()}
            style={{ padding: "8px 14px", borderRadius: 8, border: 0, background: "#0A7EA4", color: "#fff", cursor: "pointer" }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
