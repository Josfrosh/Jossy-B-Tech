ALTER TABLE public.pending_payments
  ADD COLUMN IF NOT EXISTS service_key text;

CREATE TABLE IF NOT EXISTS public.service_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  service_key text NOT NULL CHECK (service_key IN ('business', 'jobs', 'investing', 'skills', 'premium')),
  paystack_ref text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_access_reference_service_unique UNIQUE (paystack_ref, service_key)
);

CREATE INDEX IF NOT EXISTS service_access_user_expiry_idx
  ON public.service_access (user_id, expires_at DESC);

ALTER TABLE public.service_access ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own service access" ON public.service_access;
CREATE POLICY "Users can view their own service access"
  ON public.service_access
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

REVOKE ALL ON public.service_access FROM anon;
GRANT SELECT ON public.service_access TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.service_access TO service_role;
