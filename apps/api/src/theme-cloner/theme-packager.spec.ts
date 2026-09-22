import { ThemePackagerService } from './theme-packager.service';
import { StorefrontBlueprint } from './theme-cloner.types';
import AdmZip from 'adm-zip';

describe('ThemePackagerService', () => {
  let service: ThemePackagerService;

  const mockBlueprint: StorefrontBlueprint = {
    sourceDomain: 'test-shop.com',
    themeName: 'Dawn',
    themeVersion: '15.2.0',
    title: 'Test Shop Title',
    announcementBarText: 'Free Shipping Worldwide',
    ctaText: 'Explore Now',
    ctaUrl: '/collections/all',
    colors: {
      background: '#FFFFFF',
      foreground: '#121212',
      button: '#FF5500',
      buttonText: '#FFFFFF',
      secondaryButton: '#EEEEEE',
      secondaryButtonText: '#000000',
      contrast: '#DDDDDD',
    },
    typography: {
      headingFont: 'Montserrat',
      bodyFont: 'Roboto',
    },
    sections: ['announcement-bar', 'header', 'image_banner', 'featured_collection', 'footer'],
    collections: [
      { title: 'Summer Gear', handle: 'summer-gear', url: '/collections/summer-gear' },
      { title: 'Winter Coats', handle: 'winter-coats', url: '/collections/winter-coats' },
    ],
    pages: [
      { title: 'About Us', handle: 'about-us', url: '/pages/about-us', bodyHtml: '<p>About test</p>' },
    ],
    policies: [
      { type: 'refund', title: 'Refund Policy', url: '/policies/refund-policy', bodyHtml: '<p>30 days return</p>' },
    ],
    headerMenu: [{ title: 'Home', url: '/' }],
    footerMenu: [{ title: 'Privacy', url: '/policies/privacy-policy' }],
    cdnImages: [],
    analyzedAt: new Date().toISOString(),
  };

  beforeEach(() => {
    service = new ThemePackagerService();
  });

  it('should generate a valid Shopify theme zip buffer', async () => {
    const zipBuffer = await service.buildThemeZip(mockBlueprint);
    expect(zipBuffer).toBeInstanceOf(Buffer);
    expect(zipBuffer.length).toBeGreaterThan(100);

    // Verify zip entries
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries().map(e => e.entryName);

    expect(entries).toContain('layout/theme.liquid');
    expect(entries).toContain('templates/index.json');
    expect(entries).toContain('config/settings_data.json');
    expect(entries).toContain('config/settings_schema.json');
    expect(entries).toContain('sections/header.liquid');
    expect(entries).toContain('sections/image-banner.liquid');
    expect(entries).toContain('sections/announcement-bar.liquid');
    expect(entries).toContain('sections/footer.liquid');
    expect(entries).toContain('assets/base.css');

    // Verify settings_data.json contains injected colors
    const settingsEntry = zip.getEntry('config/settings_data.json');
    expect(settingsEntry).toBeDefined();
    const parsedSettings = JSON.parse(settingsEntry!.getData().toString('utf-8'));
    expect(parsedSettings.current.colors_accent_1).toBe('#FF5500');
    expect(parsedSettings.current.type_header_font).toBe('Montserrat');
  });

  it('should generate a valid content bundle zip', async () => {
    const zipBuffer = await service.buildContentPackageZip(mockBlueprint);
    expect(zipBuffer).toBeInstanceOf(Buffer);

    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries().map(e => e.entryName);

    expect(entries).toContain('pages/about-us.html');
    expect(entries).toContain('policies/refund-policy.html');
    expect(entries).toContain('navigation_menus.json');
    expect(entries).toContain('collections.json');
    expect(entries).toContain('storefront_blueprint.json');
    expect(entries).toContain('INSTRUCTIONS.md');
  });
});
