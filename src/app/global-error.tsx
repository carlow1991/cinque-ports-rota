"use client";

/**
 * Last-resort error screen (the root layout itself failed). It replaces the whole document, so it
 * renders its own <html> and <body> with inline styles and no app imports.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en-GB">
      <body style={{ margin: 0, fontFamily: "Arial, Helvetica, sans-serif", color: "#1b2533", background: "#f3f5f8" }}>
        <main role="alert" style={{ maxWidth: 480, margin: "0 auto", padding: "40px 16px" }}>
          <h1 style={{ color: "#2a426f", fontSize: 24 }}>Something went wrong</h1>
          <p>The volunteer rota couldn&apos;t load. Please try again in a moment.</p>
          {error.digest ? <p>If it keeps happening, tell your organiser and quote reference <code>{error.digest}</code>.</p> : null}
          <button type="button" onClick={() => retry()}
            style={{ minHeight: 44, padding: "0 16px", borderRadius: 8, border: 0, background: "#2a426f", color: "#fff", fontWeight: 700, fontSize: 16 }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
