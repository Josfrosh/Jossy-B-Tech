-- Paystack retries successful-charge webhooks. A unique reference allows
-- the webhook to safely upsert a single payment record for each transaction.
CREATE UNIQUE INDEX IF NOT EXISTS payments_paystack_ref_unique_idx
  ON public.payments (paystack_ref)
  WHERE paystack_ref IS NOT NULL;
