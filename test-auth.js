const http = require('http');

const registerData = JSON.stringify({
  email: 'test@projectflow.app',
  name: 'Test User',
  password: 'testpassword123'
});

const req = http.request({
  hostname: 'localhost',
  port: 3001,
  path: '/api/v1/auth/register',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': registerData.length
  }
}, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('Register Response:', res.statusCode, body);
    
    // Test Login
    const loginData = JSON.stringify({
      email: 'test@projectflow.app',
      password: 'testpassword123'
    });

    const loginReq = http.request({
      hostname: 'localhost',
      port: 3001,
      path: '/api/v1/auth/login',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': loginData.length
      }
    }, (loginRes) => {
      let loginBody = '';
      loginRes.on('data', chunk => loginBody += chunk);
      loginRes.on('end', () => {
        console.log('Login Response:', loginRes.statusCode, loginBody);
      });
    });
    loginReq.write(loginData);
    loginReq.end();
  });
});

req.on('error', error => console.error(error));
req.write(registerData);
req.end();
