function loginWithMicrosoft() {
    const msLoginUrl = '/.auth/login/aad';
    console.log('Attempting to login with Microsoft');
    console.log('Redirecting to:', msLoginUrl);
    window.location.href = msLoginUrl;
}

function loginWithGoogle() {
    const googleLoginUrl = '/.auth/login/google';
    console.log('Attempting to login with Google');
    console.log('Redirecting to:', googleLoginUrl);

    // Simulate successful Google login for testing
    simulateGoogleLogin();
}

function simulateGoogleLogin() {
    console.log('Simulating Google login...');
    // Simulate fetching user info after successful login
    setTimeout(() => {
        const mockUserData = {
            clientPrincipal: {
                userDetails: "testuser@example.com",
                identityProvider: "google",
                userId: "12345"
            }
        };
        console.log('Mock authentication data received:', mockUserData);
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('content').style.display = 'block';
    }, 1000); // Simulate network delay
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
            document.getElementById('auth-container').style.display = 'none';
            document.getElementById('content').style.display = 'block';
        } else {
            console.log('User is not authenticated');
        }
    })
    .catch(error => {
        console.error('Error fetching authentication status:', error);
    });
