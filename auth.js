/**
 * Shared Authentication Helpers
 * Centralizes Supabase client and common auth functions
 */

const SUPABASE_URL = 'https://ghsnlxqaztuovxlairvn.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_4hkjbAEhrx9kApuq7GWKPw_a5kh3RZp';
const DASHBOARD_REDIRECT_URL = 'https://compay.pro/dashboard.html';

// Initialize Supabase client
window.compayAuthClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/**
 * Get the full absolute URL for OAuth redirects
 * Works on both compay.pro and GitHub Pages
 */
function getOAuthRedirectUrl(path = 'dashboard.html') {
  const isLocalOrGHP = window.location.hostname.includes('github.io') || 
                       window.location.hostname === 'localhost';
  if (isLocalOrGHP) {
    // GitHub Pages: use full URL with repo path
    return `${window.location.protocol}//${window.location.host}/Jossy-B-Tech/${path}`;
  }
  // Custom domain: use absolute URL
  return `${window.location.protocol}//${window.location.host}/${path}`;
}

/**
 * Validate email format
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Validate password (min 8 chars)
 */
function isValidPassword(password) {
  return password && password.length >= 8;
}

/**
 * Get referral code from URL params
 * Persists across pages via localStorage
 */
function getReferralCode() {
  const params = new URLSearchParams(window.location.search);
  let ref = params.get('ref');
  
  if (ref) {
    localStorage.setItem('pendingReferralCode', ref);
  } else {
    ref = localStorage.getItem('pendingReferralCode');
  }
  
  return ref || null;
}

/**
 * Clear stored referral code after use
 */
function clearReferralCode() {
  localStorage.removeItem('pendingReferralCode');
}

/**
 * Save referral code to user profile after registration
 */
async function saveReferralCodeToProfile(userId, referralCode) {
  if (!referralCode) return;
  
  try {
    // Check if profile exists, create if not
    const { data: existingProfile } = await window.compayAuthClient
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .single();
    
    if (!existingProfile) {
      // Create new profile with referral info
      await window.compayAuthClient
        .from('profiles')
        .insert([{ 
          id: userId, 
          referred_by: referralCode,
          created_at: new Date().toISOString()
        }]);
    } else {
      // Update existing profile
      await window.compayAuthClient
        .from('profiles')
        .update({ referred_by: referralCode })
        .eq('id', userId);
    }
  } catch (e) {
    console.warn('Failed to save referral code:', e);
  }
}

/**
 * Check if user is already logged in
 * Returns session or null
 */
async function getActiveSession() {
  try {
    const { data: { session }, error } = await window.compayAuthClient.auth.getSession();
    if (error) {
      console.warn('Session check error:', error);
      return null;
    }
    return session;
  } catch (e) {
    console.warn('Error getting session:', e);
    return null;
  }
}

/**
 * Listen for auth state changes
 * Useful for syncing UI across tabs or handling logouts
 */
function onAuthStateChange(callback) {
  return window.compayAuthClient.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
}

/**
 * Redirect logged-in users away from public pages
 * Call this on index.html, login.html, register.html
 */
function getPostLoginPath(fallback = 'dashboard.html') {
  const raw = new URLSearchParams(window.location.search).get('next') || '';
  if (!raw) return fallback;
  try {
    const url = new URL(raw, window.location.href);
    if (url.origin !== window.location.origin) return fallback;
    const prefix = window.location.pathname.replace(/[^/]*$/, '');
    const service = url.searchParams.get('service') || '';
    if (!['jobs', 'investing', 'skills', 'premium'].includes(service)) return fallback;
    if (url.pathname === prefix + 'service-checkout.html') {
      return 'service-checkout.html?service=' + encodeURIComponent(service);
    }
    if (url.pathname === prefix + 'payment-return.html') {
      const reference = url.searchParams.get('reference') || url.searchParams.get('trxref') || '';
      if (!/^[A-Za-z0-9.=-]{1,100}$/.test(reference)) return fallback;
      return 'payment-return.html?service=' + encodeURIComponent(service) + '&reference=' + encodeURIComponent(reference);
    }
    return fallback;
  } catch { return fallback; }
}

async function redirectIfLoggedIn() {
  const session = await getActiveSession();
  if (session && session.user) {
    window.location.href = getPostLoginPath();
  }
}

/**
 * Require auth: redirect to login if not logged in
 * Call this on protected pages like dashboard.html
 */
async function requireAuth() {
  const session = await getActiveSession();
  if (!session || !session.user) {
    window.location.href = 'login.html';
    return null;
  }
  return session;
}
