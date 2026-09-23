"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * The enrolment secret as something a phone camera can read.
 *
 * Typing a 32-character base32 key into a phone is the worst moment in
 * setting up MFA, and it is the moment that decides whether somebody
 * enrols at all — AC-002 requires a second factor for every Owner, Admin
 * and Support actor, so anything that makes enrolment fiddly is a security
 * problem rather than a usability one.
 *
 * Rendered in the browser rather than fetched as an image. The QR encodes
 * the TOTP secret, so a server-rendered image URL would put that secret
 * somewhere new — a proxy log, a CDN cache, a browser history entry. The
 * `otpauth://` URI is already in this page's memory; drawing it here adds
 * no place for it to leak.
 *
 * The key stays on screen next to it. A QR is the fast path, not the only
 * one: desktop authenticators, password managers and anybody without a
 * working camera still need the characters.
 */
export function MfaQrCode({ uri, className = "" }: { uri: string; className?: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSvg(null);
    setFailed(false);

    QRCode.toString(uri, {
      type: "svg",
      margin: 1,
      errorCorrectionLevel: "M",
      // Explicit black on white, never the theme's colours. A scanner needs
      // contrast in the direction it expects, and a QR drawn light-on-dark
      // to match a dark page is the kind of thing that looks right in review
      // and fails on half the phones that try it.
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((out) => {
        if (!cancelled) setSvg(out);
      })
      .catch(() => {
        // Never a dead end: the key below is still enrollable by hand.
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [uri]);

  if (failed) return null;

  return (
    <div className={`flex justify-center ${className}`}>
      {/*
        The white plate is load-bearing, not decoration. The card behind it is
        dark, and the quiet zone around a QR has to be light for a scanner to
        find the finder patterns at all.
      */}
      <div className="rounded-lg bg-white p-3" aria-hidden={!svg}>
        {svg ? (
          <div
            className="h-40 w-40 [&>svg]:h-full [&>svg]:w-full"
            // The SVG is generated here from a string this page already holds,
            // not fetched or user-supplied, so there is nothing to sanitize.
            dangerouslySetInnerHTML={{ __html: svg }}
            role="img"
            aria-label="Scan this code with your authenticator app"
          />
        ) : (
          <div className="h-40 w-40 animate-pulse rounded bg-slate-200" />
        )}
      </div>
    </div>
  );
}
