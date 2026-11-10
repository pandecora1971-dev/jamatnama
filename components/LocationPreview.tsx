"use client";
import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { bn } from "@/lib/shared";
import type { LocationValue } from "./LocationFields";

type Shape = { name: string; division: string; path: string };
type Area = {
  district: string;
  name: string;
  path: string;
  point: [number, number];
};
const normalize = (value: string) =>
  value.normalize("NFC").replace(/\s+/g, "").replace(/সদর$/, "");
const matches = (a: string, b: string) =>
  !!a && !!b && normalize(a) === normalize(b);

export default function LocationPreview({
  location,
}: {
  location: LocationValue;
}) {
  const [data, setData] = useState<{ shapes: Shape[]; areas: Area[] } | null>(
    null,
  );
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all(
      ["/data/map-paths.json", "/data/location-highlights.json"].map(
        async (url) => {
          const response = await fetch(url, { signal: controller.signal });
          if (!response.ok) throw Error("Map unavailable");
          return response.json();
        },
      ),
    )
      .then(([shapes, areas]) => setData({ shapes, areas }))
      .catch((error) => {
        if (error.name !== "AbortError") setError(true);
      });
    return () => controller.abort();
  }, []);
  const area = location.upazila
    ? data?.areas.find(
        (a) =>
          matches(a.district, location.district) &&
          matches(a.name, location.upazila),
      )
    : undefined;
  const districtAreas =
    data?.areas.filter((a) => matches(a.district, location.district)) || [];
  // Use a real area's representative point, rather than inventing a precise pin.
  const districtPoint = districtAreas.length
    ? districtAreas[Math.floor(districtAreas.length / 2)].point
    : undefined;
  const point = area?.point || (location.district ? districtPoint : undefined);
  const selected = location.upazila || location.district || location.division;
  const label = area
    ? "উপজেলার আনুমানিক অবস্থান"
    : location.district
      ? "নির্বাচিত জেলার অবস্থান"
      : location.division
        ? "নির্বাচিত বিভাগের সীমানা"
        : "আপনার ঘটনার জায়গাটি কোথায়?";
  return (
    <aside
      className={`location-preview ${selected ? "has-selection" : ""}`}
      aria-label="রিপোর্টের অবস্থানের মানচিত্র"
    >
      <div className="location-preview-heading">
        <span>
          <i aria-hidden="true" />
          ঘটনার মানচিত্র
        </span>
        <small>বাংলাদেশ</small>
      </div>
      <div className="location-preview-canvas">
        <span className="map-north" aria-hidden="true">
          উত্তর ↑
        </span>
        {error ? (
          <p className="location-map-error">
            মানচিত্র দেখা যাচ্ছে না। পাশের তালিকা দিয়ে এলাকা নির্বাচন করুন।
          </p>
        ) : !data ? (
          <div className="location-map-loading">মানচিত্র প্রস্তুত হচ্ছে…</div>
        ) : (
          <svg
            viewBox="0 0 470 625"
            className="location-preview-map"
            role="img"
            aria-label={
              selected
                ? `${selected} হাইলাইট করা বাংলাদেশের মানচিত্র`
                : "বাংলাদেশের মানচিত্র; এলাকা নির্বাচনের অপেক্ষায়"
            }
          >
            {data.shapes.map((shape) => {
              const active = location.district
                ? matches(shape.name, location.district)
                : matches(shape.division, location.division);
              return (
                <path
                  key={shape.name}
                  d={shape.path}
                  className={`location-map-region ${active ? "selected" : ""} ${selected && !active ? "dimmed" : ""}`}
                />
              );
            })}
            {area && (
              <path
                key={`${area.district}-${area.name}`}
                d={area.path}
                className="location-map-area"
              />
            )}
            {point && (
              <g
                className="location-pin-position"
                style={{ transform: `translate(${point[0]}px, ${point[1]}px)` }}
              >
                <g key={selected} className="location-pin">
                  <circle className="location-pulse pulse-one" r="12" />
                  <circle className="location-pulse pulse-two" r="12" />
                  <circle className="location-pin-halo" r="12" />
                  <circle className="location-pin-core" r="5" />
                </g>
              </g>
            )}
          </svg>
        )}
        <span className="location-map-index" aria-hidden="true">
          JAMATNAMA / ০১
        </span>
      </div>
      <div
        className="location-preview-caption"
        aria-live="polite"
        aria-atomic="true"
      >
        <MapPin size={17} aria-hidden="true" />
        <div>
          <strong>{selected || "এলাকা নির্বাচন করুন"}</strong>
          <p>{label}</p>
        </div>
      </div>
      <div
        className="location-selection-steps"
        aria-label="এলাকা নির্বাচনের অগ্রগতি"
      >
        {[
          ["বিভাগ", location.division],
          ["জেলা", location.district],
          ["উপজেলা/থানা", location.upazila],
        ].map(([name, value], index) => (
          <span key={name} className={value ? "complete" : ""}>
            <b>{value ? "✓" : bn(index + 1).padStart(2, "০")}</b>
            {name}
          </span>
        ))}
      </div>
      <p className="location-preview-footnote">
        {location.upazila && !area && data
          ? "এই উপজেলা/থানার নির্ভরযোগ্য সীমানা পাওয়া যায়নি। জেলার অবস্থান দেখানো হচ্ছে।"
          : "নির্বাচিত এলাকার আনুমানিক অবস্থান। আপনার বর্তমান অবস্থান সংগ্রহ করা হয় না।"}
      </p>
    </aside>
  );
}
