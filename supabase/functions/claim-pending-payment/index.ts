import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type ServiceKey = "jobs" | "investing" | "skills" | "premium";
type PendingPayment = {
  id: string;
  plan: string;
  service_key: string | null;
  paystack_reference: string;
  created_at?: string | null;
};
type Claim = { payment: PendingPayment; service: ServiceKey; days: number };

function servicesForPending(payment: PendingPayment): Claim[] {
  const key = String(payment.service_key || "").toLowerCase();
  if (key === "jobs" || key === "investing") return [{ payment, service: key, days: 30 }];
  if (key === "skills" || key === "premium") return [{ payment, service: key, days: 90 }];

  // Compatibility for successful payments created by the older shared hosted links.
  const plan = String(payment.plan || "").toLowerCase();
  if (plan === "starter" || plan === "growth") return [
    { payment, service: "jobs", days: 30 },
    { payment, service: "investing", days: 30 },
  ];
  if (plan === "premium" || plan === "business_session") return [{ payment, service: "premium", days: 90 }];
  return [];
}

function expiryFromPayment(payment: PendingPayment, days: number): string {
  const paidAt = payment.created_at ? new Date(payment.created_at) : new Date();
  const start = Number.isNaN(paidAt.getTime()) ? Date.now() : paidAt.getTime();
  return new Date(start + days * 24 * 60 * 60 * 1000).toISOString();
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return jsonResponse({ error: "Unauthorized" }, 401);

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData.user) return jsonResponse({ error: "Unauthorized" }, 401);
  const user = userData.user;
  const email = (user.email || "").trim().toLowerCase();
  if (!email) return jsonResponse({ error: "Account has no email address" }, 400);

  const { data: pending, error: pendingError } = await admin.from("pending_payments")
    .select("id, plan, service_key, paystack_reference, created_at")
    .eq("email", email)
    .eq("claimed", false);
  if (pendingError) {
    console.error("Could not load pending payment claims", pendingError);
    return jsonResponse({ error: "Could not check pending payments" }, 500);
  }
  if (!pending || pending.length === 0) return jsonResponse({ claimed: false });

  const pendingPayments = pending as PendingPayment[];
  const claims = pendingPayments.flatMap(servicesForPending);
  if (claims.length === 0) return jsonResponse({ error: "No supported service was attached to the verified payment" }, 409);

  const accessRows = claims.map(({ payment, service, days }) => ({
    user_id: user.id,
    service_key: service,
    paystack_ref: payment.paystack_reference,
    expires_at: expiryFromPayment(payment, days),
  }));
  const { error: accessError } = await admin.from("service_access")
    .upsert(accessRows, { onConflict: "paystack_ref,service_key" });
  if (accessError) {
    console.error("Could not activate the verified service access", accessError);
    return jsonResponse({ error: "Could not activate payment access" }, 500);
  }

  const hasPremium = claims.some((claim) => claim.service === "premium");
  if (hasPremium) {
    const premiumExpiry = claims.filter((claim) => claim.service === "premium")
      .map((claim) => expiryFromPayment(claim.payment, claim.days))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
    const { error: profileError } = await admin.from("profiles").upsert({
      id: user.id,
      plan: "premium",
      plan_expires_at: premiumExpiry,
      subscription_status: "active",
      subscription_end_date: premiumExpiry,
    }, { onConflict: "id" });
    if (profileError) {
      console.error("Could not update the Premium profile summary", profileError);
      return jsonResponse({ error: "Could not update service summary" }, 500);
    }
  }

  const references = [...new Set(pendingPayments.map((payment) => payment.paystack_reference).filter(Boolean))];
  if (references.length > 0) {
    const { error: paymentUpdateError } = await admin.from("payments")
      .update({ user_id: user.id, status: "success" })
      .in("paystack_ref", references);
    if (paymentUpdateError) {
      console.error("Could not associate verified payments with the account", paymentUpdateError);
      return jsonResponse({ error: "Could not associate payment records" }, 500);
    }
  }

  const { error: claimError } = await admin.from("pending_payments")
    .update({ claimed: true })
    .in("id", pendingPayments.map((payment) => payment.id));
  if (claimError) {
    console.error("Could not mark verified payments as claimed", claimError);
    return jsonResponse({ error: "Could not finalize payment claim" }, 500);
  }

  return jsonResponse({ claimed: true, services: [...new Set(claims.map((claim) => claim.service))] });
});
