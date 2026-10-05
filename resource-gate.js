(async function () {
  const status = document.getElementById('accessStatus');
  const required = document.body.dataset.requiredService || '';
  const page = location.pathname.split('/').pop() || 'resources-free.html';
  try {
    const accessApi = window.JossyResourceAccess;
    const client = window.supabase.createClient(accessApi.SUPABASE_URL, accessApi.SUPABASE_ANON_KEY);
    const access = await accessApi.getActiveAccess(client);
    if (!access.user) { window.location.replace('login.html?next=' + encodeURIComponent(page)); return; }
    const allowed = access.premium || access.services.has(required);
    if (!allowed) { window.location.replace('resources-free.html'); return; }
    document.getElementById('protectedContent').hidden = false;
    status && status.remove();
  } catch (error) {
    console.error('Resource membership verification failed:', error);
    if (status) status.textContent = 'We could not verify your active service access right now. Please return to your dashboard and try again.';
  }
})();
