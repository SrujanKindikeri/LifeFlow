const { spawn } = require('child_process');
const http = require('http');

console.log('Starting dev server with webpack...');
const server = spawn('npx.cmd', ['next', 'dev', '--webpack', '-p', '3000'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: true
});

let output = '';
server.stdout.on('data', d => {
  const s = d.toString();
  output += s;
  process.stdout.write(s);
});
server.stderr.on('data', d => {
  const s = d.toString();
  output += s;
  process.stderr.write(s);
});

async function waitForServer(retries = 30) {
  for (let i = 0; i < retries; i++) {
    await new Promise(r => setTimeout(r, 1000));
    try {
      const res = await new Promise((resolve, reject) => {
        const req = http.get('http://127.0.0.1:3000/api/health', resolve);
        req.on('error', reject);
        req.setTimeout(1000, () => req.destroy(new Error('timeout')));
      });
      console.log('Health check status:', res.statusCode);
      return true;
    } catch (e) {
      // still starting
    }
  }
  return false;
}

async function run() {
  const ready = await waitForServer();
  if (!ready) {
    console.error('Server failed to become ready in 30s');
  } else {
    console.log('Server is ready! Testing /login...');
    const loginHtml = await new Promise((resolve, reject) => {
      http.get('http://127.0.0.1:3000/login', res => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }).on('error', reject);
    });
    console.log('/login status:', loginHtml.status);
    console.log('/login body preview (first 500 chars):\n', loginHtml.body.slice(0, 500));
    const hasScriptType = loginHtml.body.includes('type="text/javascript"');
    console.log('Has text/javascript type in HTML:', hasScriptType);

    // Check if THEME_INIT_SCRIPT is in HTML
    const hasThemeInit = loginHtml.body.includes('lifeflow-theme');
    console.log('Has theme init script in HTML:', hasThemeInit);
  }
  server.kill();
  process.exit(0);
}

run().catch(err => {
  console.error('Error during probe:', err);
  server.kill();
  process.exit(1);
});
