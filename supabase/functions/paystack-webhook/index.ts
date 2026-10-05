import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type ServiceKey = "jobs" | "investing" | "skills" | "premium";
type Entitlement = { product: string; services: ServiceKey[]; days: number; expectedAmount: number; currency: string };

const SERVICE_PRODUCTS: Record<ServiceKey, Entitlement> = {
  jobs: { product: "jobs", services: ["jobs"], days: 30, expectedAmount: 500000, currency: "NGN" },
  investing: { product: "investing", services: ["investing"], days: 30, expectedAmount: 500000, currency: "NGN" },
  skills: { product: "skills", services: ["skills"], days: 90, expectedAmount: 1200000, currency: "NGN" },
  premium: { product: "premium", services: ["premium"], days: 90, expectedAmount: 1200000, currency: "NGN" },
};

function parseMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch { /* malformed metadata is handled as a legacy transaction below */ }
  }
  return {};
}

function resolveEntitlement(amount: number, currency: string, metadata: Record<string, unknown>): Entitlement | null {
  const requestedService = typeof metadata.service_code === "string" ? metadata.service_code.toLowerCase() : "";
  if (requestedService) {
    if (!Object.prototype.hasOwnProperty.call(SERVICE_PRODUCTS, requestedService)) return null;
    const product = SERVICE_PRODUCTS[requestedService as ServiceKey];
    if (amount !== product.expectedAmount || currency !== product.currency) return null;
    return product;
  }

  // Preserve prior hosted-checkout purchases while their links are phased out.
  if (currency === "NGN" && amount === 500000) {
    return { product: "starter", services: ["jobs", "investing"], days: 30, expectedAmount: amount, currency };
  }
  if (currency === "NGN" && amount === 1200000) {
    return { product: "premium", services: ["premium"], days: 90, expectedAmount: amount, currency };
  }
  if (currency === "USD" && amount === 5000) {
    // The previously approved Business Development booking benefit remains Premium for 90 days.
    return { product: "business_session", services: ["premium"], days: 90, expectedAmount: amount, currency };
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
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(mac)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const received = signature.toLowerCase();
  if (received.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ received.charCodeAt(i);
  return mismatch === 0;
}

function textResponse(message: string, status: number): Response {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return textResponse("Method not allowed", 405);
  if (!PAYSTACK_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Webhook environment is incomplete");
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
  try { event = JSON.parse(rawBody); } catch { return textResponse("Invalid JSON", 400); }
  const data = event.data || {};
  if (event.event !== "charge.success" || data.status !== "success") {
    return textResponse("Ignored (not a successful charge)", 200);
  }

  const reference = typeof data.reference === "string" ? data.reference.trim() : "";
  const email = typeof data.customer?.email === "string" ? data.customer.email.trim().toLowerCase() : "";
  const amount = Number(data.amount);
  const currency = typeof data.currency === "string" ? data.currency.toUpperCase() : "";
  const metadata = parseMetadata(data.metadata);
  if (!reference || !email || !Number.isSafeInteger(amount) || amount <= 0 || !currency) {
    console.warn("Successful Paystack event is missing required purchase fields");
    return textResponse("Missing required payment details", 400);
  }

  const entitlement = resolveEntitlement(amount, currency, metadata);
  if (!entitlement) {
    console.warn("Successful payment has an unrecognised product, amount, or currency", amount, currency);
    return textResponse("Unrecognised product; no access granted", 200);
  }
  const metadataUserId = typeof metadata.user_id === "string" ? metadata.user_id : "";

  try {
    const { data: existing, error: lookupError } = await admin
      .from("payments").select("id, status").eq("paystack_ref", reference).maybeSingle();
    if (lookupError) throw lookupError;
    if (existing?.status === "success") return textResponse("Already processed", 200);

    const { error: recordError } = await admin.from("payments").upsert({
      paystack_ref: reference,
      plan: entitlement.product,
      amount,
      currency,
      status: "processing",
    }, { onConflict: "paystack_ref" });
    if (recordError) throw recordError;

    const { data: userPage, error: usersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (usersError) throw usersError;
    const matchedUser = userPage?.users?.find(
      (user: { id: string; email?: string | null }) => (user.email || "").toLowerCase() === email,
    );

    if (!matchedUser) {
      const { error: pendingError } = await admin.from("pending_payments").upsert({
        email,
        plan: entitlement.product,
        service_key: entitlement.services.length === 1 ? entitlement.services[0] : null,
        paystack_reference: reference,
        claimed: false,
      }, { onConflict: "paystack_reference", ignoreDuplicates: true });
      if (pendingError) throw pendingError;
      const { error: statusError } = await admin.from("payments").update({ status: "success" }).eq("paystack_ref", reference);
      if (statusError) throw statusError;
      return textResponse("Payment recorded; access will be claimed after sign-in", 200);
    }

    if (metadataUserId && metadataUserId !== matchedUser.id) {
      console.error("Signed checkout metadata user does not match Paystack customer email");
      return textResponse("Checkout account mismatch; no access granted", 200);
    }

    const expiresAt = new Date(Date.now() + entitlement.days * 24 * 60 * 60 * 1000).toISOString();
    const accessRows = entitlement.services.map((serviceKey) => ({
      user_id: matchedUser.id,
      service_key: serviceKey,
      paystack_ref: reference,
      expires_at: expiresAt,
    }));
    const { error: accessError } = await admin.from("service_access")
      .upsert(accessRows, { onConflict: "paystack_ref,service_key" });
    if (accessError) throw accessError;

    if (entitlement.services.includes("premium")) {
      const { error: profileError } = await admin.from("profiles").upsert({
        id: matchedUser.id,
        plan: entitlement.product === "business_session" ? "premium" : entitlement.product,
        plan_expires_at: expiresAt,
        subscription_status: "active",
        subscription_end_date: expiresAt,
      }, { onConflict: "id" });
      if (profileError) throw profileError;
    }

    const { error: paymentUpdateError } = await admin.from("payments")
      .update({ user_id: matchedUser.id, status: "success" }).eq("paystack_ref", reference);
    if (paymentUpdateError) throw paymentUpdateError;
    return textResponse("Payment verified and service access activated", 200);
  } catch (error) {
    console.error("Paystack webhook processing failed", error);
    return textResponse("Payment processing failed; Paystack may retry", 500);
  }
});
