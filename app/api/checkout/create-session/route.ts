import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { stripeClient } from "../../../../lib/stripe";
import { QuoteRequestSchema } from "../../../../lib/quoteGeneration";
import { adminStorage } from "../../../../lib/firebaseAdmin";

const ESTIMATE_PRICE_CENTS = 699; // $6.99 flat — automatic tax disabled until Stripe Tax is configured (see AUTOMATIC_TAX below)
const AUTOMATIC_TAX_ENABLED = false;

export async function POST(req: NextRequest) {
  try {
    if (!process.env.STRIPE_SECRET_KEY) {
      return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
    }
    if (!process.env.FIREBASE_PROJECT_ID) {
      return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
    }

    const body = await req.json();
    const parsed = QuoteRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: z.flattenError(parsed.error) },
        { status: 400 }
      );
    }

    // Persist the full request (including any uploaded plan files) so it survives
    // the redirect to Stripe and back — Cloud Storage has no practical size limit,
    // unlike sessionStorage or a Firestore document.
    const pendingId = randomUUID();
    const bucket = adminStorage().bucket();
    await bucket.file(`pending-quotes/${pendingId}.json`).save(
      JSON.stringify(parsed.data),
      { contentType: "application/json" }
    );

    const origin = req.nextUrl.origin;
    const stripe = stripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: { name: "Land Development Cost Estimate" },
            unit_amount: ESTIMATE_PRICE_CENTS,
          },
          quantity: 1,
        },
      ],
      automatic_tax: { enabled: AUTOMATIC_TAX_ENABLED },
      ...(AUTOMATIC_TAX_ENABLED ? { billing_address_collection: "required" as const } : {}),
      customer_email: parsed.data.contactEmail ?? undefined,
      metadata: { pendingId },
      success_url: `${origin}/?pending_id=${pendingId}&checkout_session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?checkout_canceled=1`,
    });

    if (!session.url) {
      return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 });
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Checkout session creation error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
