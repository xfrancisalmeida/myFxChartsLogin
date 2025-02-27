function loginWithMicrosoft() {
    console.log('Attempting to login with Microsoft');
    window.location.href = '/.auth/login/aad';
}

function loginWithGoogle() {
    console.log('Attempting to login with Google');
    window.location.href = '/.auth/login/google';
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
