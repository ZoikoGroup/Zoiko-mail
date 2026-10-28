import { BrandLoader } from "@/components/ui/BrandLoader";

// Shown inside the admin console's frame while the next page loads, so the
// rail and header stay put.
export default function Loading() {
  return <BrandLoader variant="panel" label="Loading" />;
}
