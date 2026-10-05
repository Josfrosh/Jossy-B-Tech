import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const PRODUCTS = {
  jobs: { amount: 500000, currency: "NGN", days: 30, label: "Job Opportunity & Linkup" },
  investing: { amount: 500000, currency: "NGN", days: 30, label: "Investment Education" },
  skills: { amount: 1200000, currency: "NGN", days: 90, label: "Skill Acquisition" },
  premium: { amount: 1200000, currency: "NGN", days: 90, label: "Premium Full Access" },
} as const;

type ProductCode = keyof typeof PRODUCTS;

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://compay.pro",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  if (!PAYSTACK_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Checkout environment is incomplete");
    return jsonResponse({ error: "Checkout is temporarily unavailable" }, 503);
  }

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return jsonResponse({ error: "Sign in before checkout" }, 401);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  const email = (user?.email || "").trim().toLowerCase();
  if (userError || !user || !email) return jsonResponse({ error: "A valid signed-in account is required" }, 401);

  let body: { service?: unknown };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid checkout request" }, 400);
  }

  const service = typeof body.service === "string" ? body.service.toLowerCase() : "";
  if (!Object.prototype.hasOwnProperty.call(PRODUCTS, service)) {
    return jsonResponse({ error: "Choose a supported service" }, 400);
  }
  const product = PRODUCTS[service as ProductCode];
  const callbackService = service;
  const reference = `JOSSY-${service.toUpperCase()}-${crypto.randomUUID()}`;

  try {
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount: product.amount,
        currency: product.currency,
        reference,
        callback_url: `https://compay.pro/payment-return.html?service=${encodeURIComponent(callbackService)}`,
        metadata: {
          service_code: service,
          user_id: user.id,
          product_label: product.label,
          entitlement_days: product.days,
        },
      }),
    });

    const payload = await response.json().catch(() => null);
    const authorizationUrl = payload?.data?.authorization_url;
    if (!response.ok || payload?.status !== true ||
      typeof authorizationUrl !== "string" || !authorizationUrl.startsWith("https://checkout.paystack.com/")) {
      console.error("Paystack checkout initialization was rejected", response.status);
      return jsonResponse({ error: "We could not open checkout. Please try again or contact support." }, 502);
    }

    return jsonResponse({ authorization_url: authorizationUrl, reference });
  } catch (error) {
    console.error("Paystack checkout initialization failed", error);
    return jsonResponse({ error: "Checkout could not be reached. Please try again." }, 502);
  }
});
