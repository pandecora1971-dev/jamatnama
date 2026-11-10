"use client";
import Script from "next/script";
import { useEffect, useRef, useState } from "react";

type Turnstile = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
export default function BotCheck({
  siteKey,
  action,
  resetKey,
  onToken,
}: {
  siteKey: string;
  action: "report" | "admin-login";
  resetKey: number;
  onToken: (token: string) => void;
}) {
  const target = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false),
    [error, setError] = useState(false);
  useEffect(() => {
    const api = (window as Window & { turnstile?: Turnstile }).turnstile;
    if (!ready || !siteKey || !target.current || !api) return;
    setError(false);
    onToken("");
    const id = api.render(target.current, {
      sitekey: siteKey,
      action,
      theme: "light",
      size: "flexible",
      callback: (token: string) => onToken(token),
      "expired-callback": () => onToken(""),
      "error-callback": () => {
        onToken("");
        setError(true);
      },
    });
    return () => {
      api.remove(id);
    };
  }, [siteKey, action, resetKey, ready, onToken]);
  if (!siteKey) return null;
  return (
    <div className="bot-check">
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={() => setReady(true)}
        onError={() => setError(true)}
      />
      <div ref={target} />
      {error && (
        <p className="error" role="alert">
          নিরাপত্তা যাচাই লোড হয়নি। সংযোগ পরীক্ষা করে আবার খুলুন।
        </p>
      )}
    </div>
  );
}
