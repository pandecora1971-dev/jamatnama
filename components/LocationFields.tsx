"use client";
import catalog from "@/lib/locations.json";
export type LocationValue = {
  division: string;
  district: string;
  upazila: string;
};
export default function LocationFields({
  value,
  onChange,
  required = false,
  requiredUpazila = false,
  showLabels = false,
  prefix = "",
}: {
  value: LocationValue;
  onChange: (v: LocationValue) => void;
  required?: boolean;
  requiredUpazila?: boolean;
  showLabels?: boolean;
  prefix?: string;
}) {
  const visible = required || showLabels;
  const isUpazilaRequired = requiredUpazila;
  const districts =
    catalog.find((d) => d.name === value.division)?.districts || [];
  const upazilas =
    districts.find((d) => d.name === value.district)?.upazilas || [];
  return (
    <>
      <label className={visible ? "" : "filter-label"}>
        <span className={visible ? "" : "sr-only"}>বিভাগ</span>
        <select
          name="division"
          aria-label={`${prefix}বিভাগ`}
          value={value.division}
          onChange={(e) =>
            onChange({ division: e.target.value, district: "", upazila: "" })
          }
          required={required}
        >
          <option value="">
            {visible ? "বিভাগ নির্বাচন করুন" : "সব বিভাগ"}
          </option>
          {catalog.map((d) => (
            <option key={d.name}>{d.name}</option>
          ))}
        </select>
      </label>
      <label className={visible ? "" : "filter-label"}>
        <span className={visible ? "" : "sr-only"}>জেলা</span>
        <select
          name="district"
          aria-label={`${prefix}জেলা`}
          value={value.district}
          onChange={(e) =>
            onChange({ ...value, district: e.target.value, upazila: "" })
          }
          disabled={!value.division}
          required={required}
        >
          <option value="">
            {value.division
              ? visible
                ? "জেলা নির্বাচন করুন"
                : "সব জেলা"
              : "আগে বিভাগ নির্বাচন করুন"}
          </option>
          {districts.map((d) => (
            <option key={d.name}>{d.name}</option>
          ))}
        </select>
      </label>
      <label className={visible ? "" : "filter-label"}>
        <span className={visible ? "" : "sr-only"}>
          উপজেলা/থানা{visible && !isUpazilaRequired ? " (অতিরিক্ত)" : ""}
        </span>
        <select
          name="upazila"
          aria-label={`${prefix}উপজেলা/থানা`}
          value={value.upazila}
          onChange={(e) => onChange({ ...value, upazila: e.target.value })}
          disabled={!value.district}
          required={isUpazilaRequired}
        >
          <option value="">
            {value.district
              ? visible
                ? isUpazilaRequired
                  ? "উপজেলা/থানা নির্বাচন করুন"
                  : "উপজেলা/থানা নির্বাচন করুন (অতিরিক্ত)"
                : "সব উপজেলা/থানা"
              : "আগে জেলা নির্বাচন করুন"}
          </option>
          {upazilas.map((u) => (
            <option key={u}>{u}</option>
          ))}
        </select>
      </label>
    </>
  );
}
