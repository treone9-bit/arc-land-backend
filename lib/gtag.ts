"use client";

// Fill this in once you create the "Quote Generated" conversion action in
// Google Ads (Tools & Settings > Conversions > your action > Tag setup >
// Install the tag yourself). It's the part after the slash in the event
// snippet, e.g. gtag('event', 'conversion', {'send_to': 'AW-18438758450/THIS_PART'}).
const QUOTE_GENERATED_CONVERSION_LABEL = "";

const GOOGLE_ADS_ID = "AW-18438758450";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

// Call this at the moment a customer's quote finishes generating (both the
// paid and free-mode paths). No-ops until the label above is filled in.
export function trackQuoteGeneratedConversion() {
  if (!QUOTE_GENERATED_CONVERSION_LABEL) return;
  if (typeof window === "undefined" || !window.gtag) return;
  window.gtag("event", "conversion", {
    send_to: `${GOOGLE_ADS_ID}/${QUOTE_GENERATED_CONVERSION_LABEL}`,
  });
}
