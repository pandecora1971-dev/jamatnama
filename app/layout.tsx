import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "জামাতনামা | ধর্মের দোহাইয়ে অন্যায় নয়",
  description:
    "ধর্মের দোহাই দিয়ে হয়রানি, বৈষম্য ও অধিকার হরণের অভিযোগ পরিচয় প্রকাশ ছাড়াই নথিবদ্ধ করুন।",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="bn">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
