function authenticate() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;

    // Simple authentication check
    if (username === 'user' && password === 'password') {
        document.getElementById('auth-container').style.display = 'none';
        document.getElementById('content').style.display = 'block';
    } else {
        alert('Invalid username or password!');
    }
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
