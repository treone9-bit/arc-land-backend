import Stripe from "stripe";

let _stripe: Stripe | null = null;

export function stripeClient(): Stripe {
  if (_stripe) return _stripe;

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("Stripe env var missing: STRIPE_SECRET_KEY");
  }

  _stripe = new Stripe(key);
  return _stripe;
}
