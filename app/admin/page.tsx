import Admin from "@/components/Admin";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "পর্যালোচনা প্যানেল | জামাতনামা",
  robots: { index: false, follow: false },
};
export default function Page() {
  return <Admin />;
}
