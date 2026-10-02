import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PLAN_TO_TIER: Record<string, { tier: "growth" | "premium"; days: number }> = {
  starter: { tier: "growth", days: 30 },
  premium: { tier: "premium", days: 90 },
  business_session: { tier: "premium", days: 90 },
};

type PendingPayment = { id: string; plan: string; paystack_reference: string };

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

  const { data: pending, error: pendingError } = await admin
    .from("pending_payments")
    .select("id, plan, paystack_reference")
    .eq("email", email)
    .eq("claimed", false);
  if (pendingError) {
    console.error("Could not load pending payment claims", pendingError);
    return jsonResponse({ error: "Could not check pending payments" }, 500);
  }
  if (!pending || pending.length === 0) return jsonResponse({ claimed: false });

  const pendingPayments = pending as PendingPayment[];
  const rank = (plan: string) => plan === "premium" || plan === "business_session" ? 2 : plan === "starter" ? 1 : 0;
  const best = [...pendingPayments].sort((a, b) => rank(b.plan) - rank(a.plan))[0];
  const mapped = PLAN_TO_TIER[best.plan];
  if (!mapped) return jsonResponse({ error: "Unsupported payment plan" }, 409);

  const expiresAt = new Date(Date.now() + mapped.days * 24 * 60 * 60 * 1000).toISOString();
  const { error: profileError } = await admin.from("profiles").upsert({
    id: user.id,
    plan: mapped.tier,
    plan_expires_at: expiresAt,
    subscription_status: "active",
    subscription_end_date: expiresAt,
  }, { onConflict: "id" });
  if (profileError) {
    console.error("Could not activate the verified payment entitlement", profileError);
    return jsonResponse({ error: "Could not activate payment access" }, 500);
  }

  const references = pendingPayments.map((payment) => payment.paystack_reference).filter(Boolean);
  if (references.length > 0) {
    const { error: paymentUpdateError } = await admin
      .from("payments")
      .update({ user_id: user.id, status: "success" })
      .in("paystack_ref", references);
    if (paymentUpdateError) {
      console.error("Could not associate verified payments with the account", paymentUpdateError);
      return jsonResponse({ error: "Could not associate payment records" }, 500);
    }
  }

  const { error: claimError } = await admin
    .from("pending_payments")
    .update({ claimed: true })
    .in("id", pendingPayments.map((payment) => payment.id));
  if (claimError) {
    console.error("Could not mark verified payments as claimed", claimError);
    return jsonResponse({ error: "Could not finalize payment claim" }, 500);
  }

  return jsonResponse({ claimed: true, plan: best.plan, tier: mapped.tier });
});
