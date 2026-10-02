import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type Entitlement = { product: string; tier: "growth" | "premium"; days: number };

function resolvePlan(amount: number, currency: string): Entitlement | null {
  if (currency === "NGN" && amount === 500000) {
    return { product: "starter", tier: "growth", days: 30 };
  }
  if (currency === "NGN" && amount === 1200000) {
    return { product: "premium", tier: "premium", days: 90 };
  }
  if (currency === "USD" && amount === 5000) {
    return { product: "business_session", tier: "premium", days: 90 };
  }
  return null;
}

async function verifySignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature || !PAYSTACK_SECRET_KEY) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(PAYSTACK_SECRET_KEY),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(rawBody),
  );
  const expected = Array.from(new Uint8Array(mac))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const received = signature.toLowerCase();
  if (received.length !== expected.length) return false;

  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  }
  return mismatch === 0;
}

function textResponse(message: string, status: number): Response {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return textResponse("Method not allowed", 405);
  if (!PAYSTACK_SECRET_KEY) {
    console.error("PAYSTACK_SECRET_KEY is not configured");
    return textResponse("Webhook configuration error", 500);
  }

  const rawBody = await req.text();
  let validSignature = false;
  try {
    validSignature = await verifySignature(rawBody, req.headers.get("x-paystack-signature"));
  } catch (error) {
    console.error("Could not verify Paystack signature", error);
    return textResponse("Signature verification error", 500);
  }
  if (!validSignature) return textResponse("Invalid signature", 401);

  let event: { event?: string; data?: Record<string, any> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return textResponse("Invalid JSON", 400);
  }

  const data = event.data || {};
  if (event.event !== "charge.success" || data.status !== "success") {
    return textResponse("Ignored (not a successful charge)", 200);
  }

  const reference = typeof data.reference === "string" ? data.reference.trim() : "";
  const email = typeof data.customer?.email === "string"
    ? data.customer.email.trim().toLowerCase()
    : "";
  const amount = Number(data.amount);
  const currency = typeof data.currency === "string" ? data.currency.toUpperCase() : "";
  if (!reference || !email || !Number.isSafeInteger(amount) || amount <= 0 || !currency) {
    console.warn("Paystack success event is missing required purchase fields");
    return textResponse("Missing required payment details", 400);
  }

  const entitlement = resolvePlan(amount, currency);
  if (!entitlement) {
    console.warn("Successful payment has an unrecognised amount/currency", amount, currency);
    return textResponse("Unrecognised plan; logged for review", 200);
  }

  try {
    const { data: existing, error: lookupError } = await admin
      .from("payments")
      .select("id, status")
      .eq("paystack_ref", reference)
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (existing?.status === "success") return textResponse("Already processed", 200);

    // `paystack_ref` is protected by a unique index in the accompanying migration.
    // Keep the record in `processing` until its entitlement or pending claim is saved.
    const { error: recordError } = await admin.from("payments").upsert({
      paystack_ref: reference,
      plan: entitlement.product,
      amount,
      currency,
      status: "processing",
    }, { onConflict: "paystack_ref" });
    if (recordError) throw recordError;

    const { data: userPage, error: usersError } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (usersError) throw usersError;
    const matchedUser = userPage?.users?.find(
      (user: { id: string; email?: string | null }) => (user.email || "").toLowerCase() === email,
    );

    if (!matchedUser) {
      const { error: pendingError } = await admin.from("pending_payments").upsert({
        email,
        plan: entitlement.product,
        paystack_reference: reference,
        claimed: false,
      }, { onConflict: "paystack_reference", ignoreDuplicates: true });
      if (pendingError) throw pendingError;

      const { error: paymentStatusError } = await admin
        .from("payments")
        .update({ status: "success" })
        .eq("paystack_ref", reference);
      if (paymentStatusError) throw paymentStatusError;
      return textResponse("Payment recorded; access will be claimed after sign-in", 200);
    }

    const expiresAt = new Date(Date.now() + entitlement.days * 24 * 60 * 60 * 1000).toISOString();
    const { error: profileError } = await admin.from("profiles").upsert({
      id: matchedUser.id,
      plan: entitlement.tier,
      plan_expires_at: expiresAt,
      subscription_status: "active",
      subscription_end_date: expiresAt,
    }, { onConflict: "id" });
    if (profileError) throw profileError;

    const { error: paymentUpdateError } = await admin
      .from("payments")
      .update({ user_id: matchedUser.id, status: "success" })
      .eq("paystack_ref", reference);
    if (paymentUpdateError) throw paymentUpdateError;

    return textResponse("Payment verified and access activated", 200);
  } catch (error) {
    console.error("Paystack webhook processing failed", error);
    return textResponse("Payment processing failed; Paystack may retry", 500);
  }
});
