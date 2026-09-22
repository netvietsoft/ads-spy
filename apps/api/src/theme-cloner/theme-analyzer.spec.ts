import { ThemeAnalyzerService } from './theme-analyzer.service';

describe('ThemeAnalyzerService', () => {
  let service: ThemeAnalyzerService;

  beforeEach(() => {
    service = new ThemeAnalyzerService();
  });

  it('should normalize domains properly', () => {
    expect(service.normalizeDomain('https://overtimegearz.shop/collections/all')).toBe('overtimegearz.shop');
    expect(service.normalizeDomain('http://test.myshopify.com/')).toBe('test.myshopify.com');
    expect(service.normalizeDomain('  MYSTORE.COM  ')).toBe('mystore.com');
  });

  it('should extract theme info and sections from mock HTML', () => {
    const mockHtml = `
      <!doctype html>
      <html>
        <head>
          <title>Mock Store — Best Quality</title>
          <script>Shopify.theme = {"name":"Dawn","schema_name":"Dawn","schema_version":"15.2.0"};</script>
          <script>Shopify.shop = "mock-store.myshopify.com";</script>
          <style>
            :root {
              --color-background: 255,255,255;
              --color-foreground: 18,18,18;
              --color-button: 200,10,10;
              --color-button-text: 255,255,255;
              --color-secondary-button: 255,255,255;
              --color-secondary-button-text: 18,18,18;
              --color-background-contrast: 200,200,200;
              font-family: 'Poppins', sans-serif;
            }
          </style>
        </head>
        <body>
          <div class="announcement-bar"><p>Special Sale 50% Off</p></div>
          <header>
            <a href="/"><img class="header__heading-logo" src="//mock-store.com/cdn/shop/files/logo.png" /></a>
            <a href="/collections/all">All Products</a>
            <a href="/pages/about-us">About Us</a>
          </header>
          <div id="shopify-section-template--1__image_banner">
            <div class="banner__media"><img src="//mock-store.com/cdn/shop/files/banner.jpg" /></div>
            <div class="banner__buttons"><a href="/collections/deals">Shop deals</a></div>
          </div>
          <div id="shopify-section-template--1__featured_collection"></div>
          <footer>
            <a href="/policies/refund-policy">Refund Policy</a>
            <a href="/pages/contact">Contact Us</a>
          </footer>
        </body>
      </html>
    `;

    // Test private methods via service casting
    const anyService = service as any;
    const theme = anyService.extractThemeInfo(mockHtml);
    expect(theme.name).toBe('Dawn');
    expect(theme.version).toBe('15.2.0');

    const announcement = anyService.extractAnnouncementBar(mockHtml);
    expect(announcement).toBe('Special Sale 50% Off');

    const logo = anyService.extractLogo(mockHtml, 'mock-store.com');
    expect(logo).toBe('https://mock-store.com/cdn/shop/files/logo.png');

    const hero = anyService.extractHeroBanner(mockHtml, 'mock-store.com');
    expect(hero.heroBannerUrl).toBe('https://mock-store.com/cdn/shop/files/banner.jpg');
    expect(hero.ctaText).toBe('Shop deals');
    expect(hero.ctaUrl).toBe('/collections/deals');

    const colors = anyService.extractColors(mockHtml);
    expect(colors.background).toBe('#ffffff');
    expect(colors.foreground).toBe('#121212');
    expect(colors.button).toBe('#c80a0a');
  });
});
