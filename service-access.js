(function () {
  const SUPABASE_URL = 'https://ghsnlxqaztuovxlairvn.supabase.co';
  const SUPABASE_ANON_KEY = 'sb_publishable_4hkjbAEhrx9kApuq7GWKPw_a5kh3RZp';
  const SERVICE_LABELS = { business: 'Business Development', jobs: 'Job Opportunity & Linkup', investing: 'Investment Education', skills: 'Skill Acquisition', premium: 'Premium Full Access' };
  function isUnexpired(expiry) { return !expiry || new Date(expiry).getTime() > Date.now(); }
  async function readForSession(client, session) {
    if (!session || !session.user) return { user: null, services: new Set(), premium: false };
    const [accessResult, profileResult] = await Promise.all([
      client.from('service_access').select('service_key, expires_at').eq('user_id', session.user.id),
      client.from('profiles').select('plan, subscription_status, subscription_end_date, plan_expires_at').eq('id', session.user.id).maybeSingle()
    ]);
    if (accessResult.error) throw accessResult.error;
    if (profileResult.error) throw profileResult.error;
    const services = new Set((accessResult.data || []).filter((row) => isUnexpired(row.expires_at)).map((row) => String(row.service_key || '').toLowerCase()));
    const profile = profileResult.data;
    const active = Boolean(profile && profile.subscription_status === 'active' && isUnexpired(profile.subscription_end_date || profile.plan_expires_at));
    if (active) {
      const plan = String(profile.plan || '').toLowerCase();
      if (plan === 'premium' || plan === 'business_session') services.add('premium');
      if (plan === 'growth' || plan === 'starter') { services.add('jobs'); services.add('investing'); }
    }
    const premium = services.has('premium');
    if (premium) ['jobs','investing','skills','business'].forEach((key) => services.add(key));
    return { user: session.user, services, premium };
  }
  async function getActiveAccess(client) { const { data, error } = await client.auth.getSession(); if (error) throw error; return readForSession(client, data.session); }
  window.JossyResourceAccess = { SUPABASE_URL, SUPABASE_ANON_KEY, SERVICE_LABELS, readForSession, getActiveAccess };
})();
