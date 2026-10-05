(() => {
  const form = document.querySelector('form[data-tsd-source="/src/routes/login.tsx:105:11"]') || document.querySelector('form');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const status = document.getElementById('loginStatus');
  const submitButton = form?.querySelector('button[type="submit"]');
  const buttons = Array.from(document.querySelectorAll('button'));
  const googleButton = buttons.find((button) =>
    button.textContent.trim().toLowerCase().includes('continue with google')
  );
  const forgotButton = buttons.find((button) =>
    button.textContent.trim().toLowerCase() === 'forgot your password?'
  );
  const originalSubmitMarkup = submitButton?.innerHTML;
  const originalGoogleMarkup = googleButton?.innerHTML;
  const authClient = window.compayAuthClient || null;

  function showStatus(message, kind = 'error') {
    if (!status) return;
    const isError = kind === 'error';
    status.textContent = message;
    status.style.display = 'block';
    status.style.marginBottom = '1rem';
    status.style.padding = '0.75rem 1rem';
    status.style.borderRadius = '0.5rem';
    status.style.fontSize = '0.875rem';
    status.style.color = isError ? '#fecaca' : '#a7f3d0';
    status.style.backgroundColor = isError ? 'rgba(239, 68, 68, 0.12)' : 'rgba(16, 185, 129, 0.12)';
    status.style.border = isError ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid rgba(16, 185, 129, 0.35)';
  }

  function clearStatus() {
    if (status) {
      status.textContent = '';
      status.style.display = 'none';
    }
  }

  function restoreButtons() {
    if (submitButton) {
      submitButton.disabled = false;
      if (originalSubmitMarkup !== undefined) submitButton.innerHTML = originalSubmitMarkup;
    }
    if (googleButton) {
      googleButton.disabled = false;
      if (originalGoogleMarkup !== undefined) googleButton.innerHTML = originalGoogleMarkup;
    }
  }

  // Existing authenticated users should not stay on the sign-in page.
  if (typeof redirectIfLoggedIn === 'function') {
    void redirectIfLoggedIn();
  }

  if (form) {
    // This handler prevents the form's default GET submission; never put credentials in the URL.
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearStatus();

      const email = emailInput?.value.trim() || '';
      const password = passwordInput?.value || '';
      if (!email || !password) {
        showStatus('Enter your email address and password to continue.');
        return;
      }
      if (!authClient?.auth) {
        showStatus('Sign-in is temporarily unavailable. Please try again shortly.');
        return;
      }

      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = 'Signing in…';
      }

      let redirected = false;
      try {
        const { data, error } = await authClient.auth.signInWithPassword({ email, password });
        if (error) {
          const message = /invalid login credentials/i.test(error.message)
            ? 'Invalid email or password. Please try again.'
            : /email not confirmed/i.test(error.message)
              ? 'Please confirm your email address before signing in.'
              : 'We could not sign you in. Please try again.';
          showStatus(message);
          return;
        }
        if (data?.session && data?.user) {
          redirected = true;
          window.location.replace(typeof getPostLoginPath === 'function' ? getPostLoginPath() : 'dashboard.html');
          return;
        }
        showStatus('Sign-in did not complete. Please try again.');
      } catch {
        showStatus('A connection error interrupted sign-in. Please try again.');
      } finally {
        if (!redirected) restoreButtons();
      }
    });
  }

  if (googleButton) {
    googleButton.addEventListener('click', async () => {
      clearStatus();
      if (!authClient?.auth) {
        showStatus('Google sign-in is temporarily unavailable. Please try again shortly.');
        return;
      }

      googleButton.disabled = true;
      googleButton.textContent = 'Connecting to Google…';
      try {
        const redirectTo = typeof getOAuthRedirectUrl === 'function'
          ? getOAuthRedirectUrl(typeof getPostLoginPath === 'function' ? getPostLoginPath() : 'dashboard.html')
          : new URL(typeof getPostLoginPath === 'function' ? getPostLoginPath() : 'dashboard.html', window.location.href).href;
        const { error } = await authClient.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo,
            queryParams: { access_type: 'offline', prompt: 'consent' },
          },
        });
        if (error) {
          showStatus('Google sign-in could not be started. Please try again.');
          restoreButtons();
        }
      } catch {
        showStatus('A connection error interrupted Google sign-in. Please try again.');
        restoreButtons();
      }
    });
  }

  // Keep the existing forgot-password control navigating to its current route.
  if (forgotButton) {
    forgotButton.addEventListener('click', () => {
      window.location.href = 'reset-password.html';
    });
  }
})();

(() => { const next = typeof getPostLoginPath === 'function' ? getPostLoginPath('') : ''; if (!next) return; document.querySelectorAll('a[href^="register.html"]').forEach((a) => { a.href = 'register.html?next=' + encodeURIComponent(next); }); })();
