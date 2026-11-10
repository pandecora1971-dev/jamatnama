"use client";

import { useEffect, useRef, useState } from "react";
import illustrationSheets from "../public/illustrations/mission-scenes.json";

// Each scene is an original, symbolic illustration, not a depiction of a real incident.
const scenes = [
  {
    title: "ধর্মের দোহাইয়ে সেবা থেকে বঞ্চনা",
    caption: "ধর্মীয় পরিচয়ের কারণে ত্রাণ বা সেবা আটকে দিলে কী ঘটেছে তা জানান।",
    kind: "aid",
  },
  {
    title: "বিশ্বাসের কারণে বৈষম্য",
    caption: "অন্য বিশ্বাসের কাউকে সমাজের সুযোগ থেকে বাদ দেওয়ার অভিযোগ নথিবদ্ধ করুন।",
    kind: "exclusion",
  },
  {
    title: "ধর্মের দোহাইয়ে কণ্ঠরোধ",
    caption: "ধর্মের ব্যাখ্যা টেনে কাউকে চুপ করানো বা ভয় দেখানোর ঘটনা জানান।",
    kind: "silence",
  },
  {
    title: "হয়রানির মুখে পাশে দাঁড়ানো",
    caption: "ধর্মের নামে ভয় দেখানো হলে ক্ষতিগ্রস্ত মানুষের পাশে দাঁড়ান ও ঘটনাটি জানান।",
    kind: "support",
  },
] as const;

function SceneIllustration({ index, title }: { index: number; title: string }) {
  const sheet = illustrationSheets[Math.floor(index / 4)];
  const frame = sheet.frames[index % 4];
  const clip = `hero-illustration-${index}`;
  return <svg
    className="hero-scene-illustration"
    width="720" height="680"
    viewBox={`${frame.left} ${frame.top} ${frame.width} ${frame.height}`}
    preserveAspectRatio="xMidYMid meet"
    role="img" aria-label={title}
  >
    <defs><clipPath id={clip}><rect x={frame.left} y={frame.top} width={frame.width} height={frame.height}/></clipPath></defs>
    <image href={sheet.src} width={sheet.width} height={sheet.height} clipPath={`url(#${clip})`}/>
  </svg>;
}

export default function EditorialHero() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [reduced, setReduced] = useState(false);
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setReduced(preference.matches);
    let intersecting = true;
    const syncVisibility = () => setVisible(intersecting && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting;
      syncVisibility();
    });
    syncPreference();
    syncVisibility();
    if (root.current) observer.observe(root.current);
    preference.addEventListener("change", syncPreference);
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      observer.disconnect();
      preference.removeEventListener("change", syncPreference);
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);

  useEffect(() => {
    // Warm the local sheets so later scenes do not flash while loading.
    for (const sheet of illustrationSheets) {
      const image = new Image();
      image.src = sheet.src;
    }
  }, []);

  const next = () => setIndex((current) => (current + 1) % scenes.length);
  const scene = scenes[index];
  const stopped = paused || !visible || reduced;

  return (
    <figure
      ref={root}
      className={`hero-stories hero-cartoons jm-editorial-hero${stopped ? " is-paused" : ""}${reduced ? " is-reduced" : ""}`}
      aria-label={`ধর্মের দোহাইয়ে অন্যায় নিয়ে ${scenes.length.toString().replace(/\d/g, (digit) => "০১২৩৪৫৬৭৮৯"[Number(digit)])}টি প্রতীকী দৃশ্য`}
    >
      <div className="hero-story-topline">
        <span>ঘটনার প্রতীকী চিত্র</span>
        <span>
          {String(index + 1)
            .padStart(2, "0")
            .replace(/\d/g, (digit) => "০১২৩৪৫৬৭৮৯"[Number(digit)])}{" "}
          / {scenes.length.toString().replace(/\d/g, (digit) => "০১২৩৪৫৬৭৮৯"[Number(digit)])}
        </span>
      </div>
      <div
        key={index}
        className="hero-story-frame"
        onAnimationEnd={(event) => {
          if (
            event.target === event.currentTarget &&
            event.animationName === "hero-story-cycle" &&
            !stopped
          )
            next();
        }}
      >
        <SceneIllustration index={index} title={scene.title} />
        <div className="hero-story-caption">
          <strong>{scene.title}</strong>
          <span>{scene.caption}</span>
        </div>
      </div>
      <div className="hero-story-controls">
        <div className="hero-story-steps" aria-hidden="true">
          {scenes.map((item, i) => (
            <span key={item.kind} className={i === index ? "is-current" : ""} />
          ))}
        </div>
        {!reduced && (
          <button
            type="button"
            onClick={() => setPaused(!paused)}
            aria-label={paused ? "অ্যানিমেশন চালু করুন" : "অ্যানিমেশন থামান"}
            aria-pressed={paused}
          >
            {paused ? "চালু" : "থামান"}
          </button>
        )}
        <button type="button" onClick={next} aria-label="পরের চিত্র দেখুন">
          পরের চিত্র <span aria-hidden="true">↗</span>
        </button>
      </div>
    </figure>
  );
}
