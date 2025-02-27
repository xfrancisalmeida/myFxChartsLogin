function loginWithGoogle() {
    window.location.href = '/.auth/login/google';
}

// Check for Azure authentication
fetch('/.auth/me')
    .then(response => response.json())
    .then(data => {
        if (data.clientPrincipal) {
            document.getElementById('auth-container').style.display = 'none';
            document.getElementById('content').style.display = 'block';
        }
    });
