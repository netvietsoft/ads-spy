import https from 'https';

const url = 'https://overtimegearz.shop/';
https.get(url, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } }, (res) => {
  let body = '';
  res.on('data', (c) => body += c);
  res.on('end', () => {
    const themeMatch = body.match(/Shopify\.theme\s*=\s*({[^}]+})/);
    console.log('THEME INFO:', themeMatch ? themeMatch[1] : 'Not found');
    
    // Tìm theme name qua script / css
    const themeNameMatch = body.match(/theme_name:\s*["']([^"']+)["']/i) || body.match(/window\.BOOMR\s*=.*?theme_name:\s*["']([^"']+)["']/i) || body.match(/var theme = {[^}]+name:\s*["']([^"']+)["']/i);
    console.log('THEME NAME:', themeNameMatch ? themeNameMatch[1] : 'Not found');

    // Tìm các file css
    const cssMatches = body.match(/href=["'](https:\/\/[^"']+\.css[^"']*)["']/gi) || [];
    console.log('CSS FILES:', cssMatches.slice(0, 5));

    // Tìm title và logo
    const titleMatch = body.match(/<title>([^<]+)<\/title>/i);
    console.log('TITLE:', titleMatch ? titleMatch[1].trim() : 'N/A');

    // Check Shopify Storefront ID
    const shopIdMatch = body.match(/Shopify\.shop\s*=\s*["']([^"']+)["']/);
    console.log('SHOP DOMAIN:', shopIdMatch ? shopIdMatch[1] : 'N/A');
  });
}).on('error', console.error);
