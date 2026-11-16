const { sealData } = require('iron-session');
const http = require('http');

async function main() {
  const sessionData = {
    userId: '6a9fc3ebc72994a2a2090857',
    name: 'Kindikeri Srujan Kumar Reddy',
    email: 'kindikerisr@gmail.com',
    isLoggedIn: true,
    emailVerified: true,
    loginAt: Date.now(),
    lastActiveAt: Date.now()
  };

  const password = process.env.SESSION_SECRET;
  if (!password) {
    console.error('No SESSION_SECRET');
    process.exit(1);
  }

  const sealed = await sealData(sessionData, { password });
  console.log('Sealed session cookie length:', sealed.length);

  const req = http.request('http://localhost:3000/app/dashboard', {
    method: 'GET',
    headers: {
      'Cookie': `lifeflow_session=${sealed}`,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  }, res => {
    console.log('Response Status:', res.statusCode);
    console.log('Response Headers:', res.headers);
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      console.log('Response body length:', body.length);
      console.log('Has $RS in body:', body.includes('$RS'));
      if (body.includes('$RS')) {
        const idx = body.indexOf('$RS');
        console.log('$RS snippet:', body.slice(Math.max(0, idx - 100), idx + 200));
      }
      console.log('Has [app error] or ErrorPage:', body.includes('error.tsx') || body.includes('Something went wrong'));
      console.log('Has DashboardClient:', body.includes('DashboardClient') || body.includes('today'));
    });
  });

  req.on('error', err => {
    console.error('Request failed:', err);
  });

  req.end();
}

main().catch(console.error);
