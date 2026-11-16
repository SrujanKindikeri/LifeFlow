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
  const sealed = await sealData(sessionData, { password: process.env.SESSION_SECRET });

  http.get('http://localhost:3000/app/dashboard', {
    headers: { 'Cookie': 'lifeflow_session=' + sealed }
  }, res => {
    let body = '';
    res.on('data', c => { body += c; });
    res.on('end', () => {
      console.log('Includes Something went wrong:', body.includes('Something went wrong'));
      console.log('Includes app_error_tsx script chunk:', body.includes('app_error_tsx'));
      console.log('Includes DashboardClient:', body.includes('DashboardClient'));
      console.log('Includes Focus for Today:', body.includes('Focus for Today'));
      console.log('Includes TodayTimeline:', body.includes('TodayTimeline'));
      console.log('Includes QuickAddModal:', body.includes('QuickAddModal'));
      console.log('Includes LifeFlow Score:', body.includes('LifeFlow Score'));

      // Check where $RS is and what its parameters are
      const rsMatches = body.match(/\$RS\([^)]+\)/g);
      console.log('$RS calls found:', rsMatches);

      // Check whether template / placeholder ids exist in HTML
      if (rsMatches) {
        rsMatches.forEach(call => {
          const parts = call.match(/\"([^"]+)\"/g);
          if (parts && parts.length >= 2) {
            const idA = parts[0].replace(/\"/g, '');
            const idB = parts[1].replace(/\"/g, '');
            console.log('Check idA:', idA, 'exists in body:', body.includes('id="' + idA + '"'));
            console.log('Check idB:', idB, 'exists in body:', body.includes('id="' + idB + '"'));
          }
        });
      }
    });
  });
}
main();
