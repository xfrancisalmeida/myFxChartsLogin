function loginWithMicrosoft() {
    const msLoginUrl = '/.auth/login/aad';
    console.log('Attempting to login with Microsoft');
    console.log('Redirecting to:', msLoginUrl);
    window.location.href = msLoginUrl;
}

// Check for Azure authentication
fetch('/.auth/me')
    .then(response => {
        console.log('Fetching authentication status...');
        return response.json();
    })
    .then(data => {
        console.log('Authentication data received:', data);
        if (data.clientPrincipal) {
            console.log('User is authenticated');
            console.log('Authentication Provider:', data.clientPrincipal.identityProvider);
            document.getElementById('auth-container').style.display = 'none';
            document.getElementById('content').style.display = 'block';
        } else {
            console.log('User is not authenticated');
        }
    })
    .catch(error => {
        console.error('Error fetching authentication status:', error);
    });
