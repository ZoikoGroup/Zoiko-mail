import { BrandLoader } from "@/components/ui/BrandLoader";

// Shown inside the owner console's frame while the next page loads, so the
// sidebar and header stay put.
export default function Loading() {
  return <BrandLoader variant="panel" label="Loading" />;
}
