async function run() {
  try {
    const res = await fetch('https://overtimegearz.shop/');
    const html = await res.text();

    // 1. CDN images (Banners, Logos, Icons)
    const imgRegex = /(?:src|srcset)=["']([^"']+)["']/gi;
    const cdnImages = new Set();
    let m;
    while ((m = imgRegex.exec(html)) !== null) {
      const parts = m[1].split(',');
      for (const p of parts) {
        const url = p.trim().split(' ')[0];
        if (url.includes('/files/') || url.includes('cdn/shop')) {
          const fullUrl = url.startsWith('//') ? 'https:' + url : (url.startsWith('http') ? url : 'https://overtimegearz.shop' + url);
          cdnImages.add(fullUrl);
        }
      }
    }

    // 2. Sections
    const sectionRegex = /shopify-section-([a-zA-Z0-9_-]+)/g;
    const sections = [...new Set([...html.matchAll(sectionRegex)].map(m => m[1]))];

    // 3. Menus / Collections
    const linkRegex = /href="(\/(?:collections|pages|policies)[^"]*)"[^>]*>([^<]+)<\/a>/gi;
    const links = [];
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const url = match[1];
      const title = match[2].trim();
      if (title && !links.some(l => l.url === url)) {
        links.push({ url, title });
      }
    }

    // 4. Color scheme & Fonts
    const fonts = [...new Set([...html.matchAll(/font-family:\s*([^;]+);/gi)].map(m => m[1].trim()))];
    const colors = [...new Set([...html.matchAll(/--color-([a-z0-9_-]+):\s*([^;]+);/gi)].map(m => `${m[1]}: ${m[2]}`))];

    const cdnList = [...cdnImages].filter(u => /\.(jpe?g|png|webp|svg)/i.test(u));
    console.log('=== STOREFRONT INSPECTION RESULT ===');
    console.log('Total Storefront Images:', cdnList.length);
    console.log('Sample Images (Banners/Logos):', cdnList.slice(0, 10));
    console.log('\nSections detected on homepage:', sections);
    console.log('\nNavigation / Links:', links.slice(0, 15));
    console.log('\nFonts detected:', fonts.slice(0, 5));
    console.log('\nColor tokens sample:', colors.slice(0, 10));
  } catch (err) {
    console.error('Error inspecting:', err.message);
  }
}

run();
