import { BrandLoader } from "@/components/ui/BrandLoader";

/**
 * The Suspense fallback for the member workspace's pages (/mail and its
 * sections). They read the URL's query string, so a production build renders
 * them in the browser only and serves this fallback as the page's first HTML:
 * without it, a fresh load showed a blank page until the scripts arrived.
 * It hands over to WebmailShell's own session loader without a blink (see
 * BrandLoader's loader-to-loader continuation).
 */
export function WebmailLoading() {
  return <BrandLoader className="zm-webmail" label="Loading Zoiko Mail" />;
}

export default WebmailLoading;
