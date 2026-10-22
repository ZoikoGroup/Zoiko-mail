"use client";

import Image from "next/image";

interface AuthBrandProps {
  /** Smaller lockup for forms that already have a lot to fit in the card. */
  compact?: boolean;
}

/**
 * App icon over the wordmark, at the top of the sign-in card.
 *
 * Two wordmarks: the default is navy ink, which disappears on the dark card,
 * so dark mode swaps in the lifted variant the showcase panel uses.
 */
export default function AuthBrand({ compact = false }: AuthBrandProps) {
  const iconSize = compact ? 52 : 72;

  return (
    <div className={`flex flex-col items-center ${compact ? "gap-2.5" : "gap-3"}`}>
      <Image
        src="/zoiko-icon.png"
        width={iconSize}
        height={iconSize}
        // Smaller on short screens so the form still fits without scrolling far.
        className={`rounded-2xl shadow-lg shadow-blue-600/25 ${compact ? "" : "[@media(max-height:760px)]:h-14 [@media(max-height:760px)]:w-14"} [@media(max-height:760px)]:rounded-xl`}
        alt=""
        priority
      />
      <Image
        src="/zoiko-wordmark.png"
        width={277}
        height={36}
        className={`${compact ? "h-6" : "h-7"} w-auto dark:hidden`}
        alt="Zoiko Mail"
        priority
      />
      <Image
        src="/zoiko-wordmark-dark.png"
        width={277}
        height={36}
        className={`${compact ? "h-6" : "h-7"} hidden w-auto dark:block`}
        alt="Zoiko Mail"
        priority
      />
    </div>
  );
}
