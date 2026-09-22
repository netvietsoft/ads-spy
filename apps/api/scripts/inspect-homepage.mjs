import https from 'https';

const url = 'https://overtimegearz.shop/';
https.get(url, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, (res) => {
  let body = '';
  res.on('data', (c) => body += c);
  res.on('end', () => {
    const cdnMatches = body.match(/\/\/cdn\.shopify\.com\/s\/files\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp|svg)/gi) || [];
    const unique = Array.from(new Set(cdnMatches.map(u => 'https:' + u)));
    console.log('TOTAL CDN ASSETS:', unique.length);
    console.log('SAMPLE ASSETS:');
    unique.slice(0, 10).forEach(u => console.log('  ' + u));

    // Check collections
    const collections = body.match(/\/collections\/[a-zA-Z0-9_-]+/g) || [];
    console.log('COLLECTIONS FOUND:', Array.from(new Set(collections)));
  });
}).on('error', console.error);
