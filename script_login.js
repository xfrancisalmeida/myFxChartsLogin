// 1) Check if user is already authenticated via Azure Static Web Apps:
fetch('/.auth/me')
  .then((res) => res.json())
  .then((data) => {
    if (data.clientPrincipal) {
      // Already logged in => go straight to app
      window.location.href = 'app.html';
    }
  })
  .catch((err) => {
    console.log('Error checking auth status on login page:', err);
  });

// 2) If user clicks “Login with Microsoft,” start the SWA AAD login flow
document.getElementById('btnLogin').addEventListener('click', () => {
  // Azure SWA endpoint for logging in w/ AAD
  const msLoginUrl = '/.auth/login/aad';
  window.location.href = msLoginUrl;
});
