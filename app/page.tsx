import Home from "@/components/Home";
// A static shell served from the CDN. Reports load from the cached public API, so a traffic spike
// costs no database work per page view and a withdrawn report can never persist in page HTML.
export default function Page() {
  return <Home />;
}
