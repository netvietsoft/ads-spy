import { Injectable, Logger } from '@nestjs/common';
import {
  StorefrontBlueprint,
  ScrapedCollection,
  ScrapedPage,
  ScrapedPolicy,
  ScrapedMenuLink,
} from './theme-cloner.types';

@Injectable()
export class ThemeAnalyzerService {
  private readonly logger = new Logger(ThemeAnalyzerService.name);

  private readonly userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

  normalizeDomain(raw: string): string {
    let clean = raw.trim().toLowerCase();
    clean = clean.replace(/^https?:\/\//, '');
    clean = clean.replace(/\/.*$/, '');
    return clean;
  }

  async analyze(targetDomainInput: string): Promise<StorefrontBlueprint> {
    const domain = this.normalizeDomain(targetDomainInput);
    this.logger.log(`Starting storefront analysis for ${domain}`);

    const homepageUrl = `https://${domain}/`;
    const res = await fetch(homepageUrl, {
      headers: {
        'User-Agent': this.userAgent,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch ${homepageUrl}: HTTP ${res.status}`);
    }

    const html = await res.text();

    // 1. Theme detection
    const themeInfo = this.extractThemeInfo(html);

    // 2. Shop domain
    const shopDomainMatch = html.match(/Shopify\.shop\s*=\s*["']([^"']+)["']/i);
    const myshopifyDomain = shopDomainMatch ? shopDomainMatch[1] : undefined;

    // 3. Title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : domain;

    // 4. Announcement bar
    const announcementBarText = this.extractAnnouncementBar(html);

    // 5. Logo and Favicon
    const logoUrl = this.extractLogo(html, domain);
    const faviconUrl = this.extractFavicon(html, domain);

    // 6. Hero Banner and CTA
    const { heroBannerUrl, ctaText, ctaUrl } = this.extractHeroBanner(html, domain);

    // 7. Colors & Typography
    const colors = this.extractColors(html);
    const typography = this.extractTypography(html);

    // 8. Sections
    const sections = this.extractSections(html);

    // 9. Navigation Menus
    const { headerMenu, footerMenu } = this.extractMenus(html);

    // 10. Collections
    const collections = await this.extractCollections(html, domain);

    // 11. Pages & Policies (with body content)
    const pages = await this.extractPages(html, domain);
    const policies = await this.extractPolicies(html, domain);

    // 12. CDN Images
    const cdnImages = this.extractCdnImages(html, domain);

    return {
      sourceDomain: domain,
      myshopifyDomain,
      themeName: themeInfo.name,
      themeVersion: themeInfo.version,
      title,
      announcementBarText,
      logoUrl,
      faviconUrl,
      heroBannerUrl,
      ctaText,
      ctaUrl,
      colors,
      typography,
      sections,
      collections,
      pages,
      policies,
      headerMenu,
      footerMenu,
      cdnImages,
      analyzedAt: new Date().toISOString(),
    };
  }

  private extractThemeInfo(html: string): { name: string; version: string } {
    let name = 'Dawn';
    let version = '15.2.0';

    const themeJsonMatch = html.match(/Shopify\.theme\s*=\s*({[^;]+});/i);
    if (themeJsonMatch) {
      try {
        const parsed = JSON.parse(themeJsonMatch[1]);
        if (parsed.schema_name) name = parsed.schema_name;
        if (parsed.schema_version) version = parsed.schema_version;
        else if (parsed.name) name = parsed.name;
      } catch (e) {
        // ignore parse error
      }
    }

    if (name === 'theme-export' || name === 'Dawn') {
      const dawnVersionMatch = html.match(/theme-export.*?(\d+\.\d+\.\d+)/i) || html.match(/Dawn.*?(\d+\.\d+\.\d+)/i);
      if (dawnVersionMatch) version = dawnVersionMatch[1];
      name = 'Dawn';
    }

    return { name, version };
  }

  private extractAnnouncementBar(html: string): string | undefined {
    const match =
      html.match(/class=["'][^"']*announcement-bar__message[^"']*["'][^>]*>([\s\S]*?)<\/p>/i) ||
      html.match(/class=["'][^"']*announcement-bar[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);

    if (match) {
      return match[1].replace(/<[^>]+>/g, '').trim();
    }
    return 'Welcome to Our Store';
  }

  private extractLogo(html: string, domain: string): string | undefined {
    // 1. Look for header logo wrapper or logo class
    const wrapperMatch = html.match(/class=["'][^"']*header__heading-logo(?:-wrapper)?[^"']*["'][\s\S]*?<img[^>]*src=["']([^"']+)["']/i);
    if (wrapperMatch) {
      return this.formatUrl(wrapperMatch[1], domain);
    }

    // 2. Look for any image matching logo or lo_go in src or srcset
    const logoRegex = /(?:src|srcset)=["']([^"']*(?:logo|lo_go)[^"']*\.(?:png|jpg|webp|svg)[^"']*)["']/i;
    const looseLogo = html.match(logoRegex);
    if (looseLogo) {
      const firstUrl = looseLogo[1].split(',')[0].trim().split(' ')[0];
      return this.formatUrl(firstUrl, domain);
    }
    return undefined;
  }

  private extractFavicon(html: string, domain: string): string | undefined {
    const match = html.match(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i);
    return match ? this.formatUrl(match[1], domain) : undefined;
  }

  private extractHeroBanner(html: string, domain: string): { heroBannerUrl?: string; ctaText?: string; ctaUrl?: string } {
    let heroBannerUrl: string | undefined;
    let ctaText: string | undefined = 'Shop now';
    let ctaUrl: string | undefined = '/collections/all';

    // Image banner
    const bannerRegex = /class=["'][^"']*(?:banner__media|image_banner)[^"']*["'][\s\S]*?<img[^>]*src=["']([^"']+)["']/i;
    const bannerMatch = html.match(bannerRegex);
    if (bannerMatch) {
      heroBannerUrl = this.formatUrl(bannerMatch[1], domain);
    } else {
      // Look for baner.jpg or banner.jpg
      const anyBanner = html.match(/(?:src|srcset)=["']([^"']*(?:banner|baner)[^"']*\.(?:jpg|png|webp)[^"']*)["']/i);
      if (anyBanner) {
        const u = anyBanner[1].split(',')[0].trim().split(' ')[0];
        heroBannerUrl = this.formatUrl(u, domain);
      }
    }

    // CTA button
    const ctaMatch = html.match(/class=["'][^"']*(?:banner__buttons|button--primary)[^"']*["'][^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (ctaMatch) {
      ctaUrl = ctaMatch[1];
      ctaText = ctaMatch[2].replace(/<[^>]+>/g, '').trim();
    }

    return { heroBannerUrl, ctaText, ctaUrl };
  }

  private extractColors(html: string): StorefrontBlueprint['colors'] {
    const bgMatch = html.match(/--color-background:\s*([^;]+);/i);
    const fgMatch = html.match(/--color-foreground:\s*([^;]+);/i);
    const btnMatch = html.match(/--color-button:\s*([^;]+);/i);
    const btnTextMatch = html.match(/--color-button-text:\s*([^;]+);/i);
    const secBtnMatch = html.match(/--color-secondary-button:\s*([^;]+);/i);
    const secBtnTextMatch = html.match(/--color-secondary-button-text:\s*([^;]+);/i);
    const contrastMatch = html.match(/--color-background-contrast:\s*([^;]+);/i);

    const rgbToHex = (val?: string, fallback = '#ffffff') => {
      if (!val) return fallback;
      const parts = val.trim().split(',').map(p => parseInt(p.trim(), 10));
      if (parts.length >= 3 && !parts.some(isNaN)) {
        return (
          '#' +
          parts
            .slice(0, 3)
            .map(x => x.toString(16).padStart(2, '0'))
            .join('')
        );
      }
      return val.trim();
    };

    return {
      background: rgbToHex(bgMatch ? bgMatch[1] : undefined, '#FFFFFF'),
      foreground: rgbToHex(fgMatch ? fgMatch[1] : undefined, '#121212'),
      button: rgbToHex(btnMatch ? btnMatch[1] : undefined, '#121212'),
      buttonText: rgbToHex(btnTextMatch ? btnTextMatch[1] : undefined, '#FFFFFF'),
      secondaryButton: rgbToHex(secBtnMatch ? secBtnMatch[1] : undefined, '#FFFFFF'),
      secondaryButtonText: rgbToHex(secBtnTextMatch ? secBtnTextMatch[1] : undefined, '#121212'),
      contrast: rgbToHex(contrastMatch ? contrastMatch[1] : undefined, '#BFBFBF'),
    };
  }

  private extractTypography(html: string): StorefrontBlueprint['typography'] {
    let headingFont = 'Montserrat';
    let bodyFont = 'Roboto';

    const fonts = [...new Set([...html.matchAll(/font-family:\s*([^;]+);/gi)].map(m => m[1].trim()))];
    if (fonts.length > 0) {
      const cleanFonts = fonts
        .map(f => f.replace(/["']/g, '').split(',')[0].trim())
        .filter(f => f && !f.startsWith('var('));
      if (cleanFonts.length >= 1) headingFont = cleanFonts[0];
      if (cleanFonts.length >= 2) bodyFont = cleanFonts[1];
      else bodyFont = headingFont;
    }

    return { headingFont, bodyFont };
  }

  private extractSections(html: string): string[] {
    const sectionRegex = /shopify-section-([a-zA-Z0-9_-]+)/g;
    const matches = [...new Set([...html.matchAll(sectionRegex)].map(m => m[1]))];
    return matches.length > 0
      ? matches
      : [
          'announcement-bar',
          'header',
          'image_banner',
          'collection_list',
          'featured_collection',
          'footer',
        ];
  }

  private extractMenus(html: string): { headerMenu: ScrapedMenuLink[]; footerMenu: ScrapedMenuLink[] } {
    const headerMenu: ScrapedMenuLink[] = [];
    const footerMenu: ScrapedMenuLink[] = [];

    // Header nav links
    const headerRegex = /<header[\s\S]*?<\/header>/i;
    const headerMatch = html.match(headerRegex);
    if (headerMatch) {
      const linkRegex = /href=["'](\/(?:collections|pages)[^"']*)["'][^>]*>([^<]+)<\/a>/gi;
      let m;
      while ((m = linkRegex.exec(headerMatch[0])) !== null) {
        const title = m[2].trim();
        const url = m[1];
        if (title && !headerMenu.some(l => l.url === url)) {
          headerMenu.push({
            title,
            url,
            type: url.includes('/collections') ? 'collection' : 'page',
          });
        }
      }
    }

    // Fallback if header menu empty
    if (headerMenu.length === 0) {
      headerMenu.push(
        { title: 'Home', url: '/' },
        { title: 'All Products', url: '/collections/all', type: 'collection' },
        { title: 'About Us', url: '/pages/about-us', type: 'page' },
        { title: 'Contact', url: '/pages/contact', type: 'page' },
      );
    }

    // Footer links
    const footerRegex = /<footer[\s\S]*?<\/footer>/i;
    const footerMatch = html.match(footerRegex);
    if (footerMatch) {
      const linkRegex = /href=["'](\/(?:policies|pages|collections)[^"']*)["'][^>]*>([^<]+)<\/a>/gi;
      let m;
      while ((m = linkRegex.exec(footerMatch[0])) !== null) {
        const title = m[2].trim();
        const url = m[1];
        if (title && !footerMenu.some(l => l.url === url)) {
          footerMenu.push({
            title,
            url,
            type: url.includes('/policies') ? 'policy' : url.includes('/collections') ? 'collection' : 'page',
          });
        }
      }
    }

    return { headerMenu, footerMenu };
  }

  private async extractCollections(html: string, domain: string): Promise<ScrapedCollection[]> {
    const collections: ScrapedCollection[] = [];

    // Try /collections.json first
    try {
      const res = await fetch(`https://${domain}/collections.json`, {
        headers: { 'User-Agent': this.userAgent },
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.collections)) {
          for (const c of data.collections) {
            collections.push({
              title: c.title,
              handle: c.handle,
              url: `/collections/${c.handle}`,
              imageUrl: c.image?.src || undefined,
            });
          }
          if (collections.length > 0) return collections;
        }
      }
    } catch (e) {
      // fallback
    }

    // Fallback: extract from HTML links
    const colRegex = /href=["']\/collections\/([a-zA-Z0-9_-]+)["'][^>]*>([^<]+)<\/a>/gi;
    let m;
    while ((m = colRegex.exec(html)) !== null) {
      const handle = m[1];
      const title = m[2].trim();
      if (handle !== 'all' && title && !collections.some(c => c.handle === handle)) {
        collections.push({
          title,
          handle,
          url: `/collections/${handle}`,
        });
      }
    }

    return collections;
  }

  private async extractPages(html: string, domain: string): Promise<ScrapedPage[]> {
    const pageHandles = ['about-us', 'contact', 'faqs', 'track-order', 'dcma'];
    const pages: ScrapedPage[] = [];

    // Check what pages are mentioned in HTML
    const pageRegex = /href=["']\/pages\/([a-zA-Z0-9_-]+)["'][^>]*>([^<]+)<\/a>/gi;
    let m;
    const foundHandles = new Set<string>(pageHandles);
    while ((m = pageRegex.exec(html)) !== null) {
      foundHandles.add(m[1]);
    }

    for (const handle of foundHandles) {
      try {
        const pageUrl = `https://${domain}/pages/${handle}`;
        const res = await fetch(pageUrl, {
          headers: { 'User-Agent': this.userAgent },
        });
        if (res.ok) {
          const pageHtml = await res.text();
          const titleMatch = pageHtml.match(/<h1[^>]*>([^<]+)<\/h1>/i) || pageHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
          const title = titleMatch ? titleMatch[1].trim() : handle.replace(/-/g, ' ').toUpperCase();

          // Extract content from .rte or main
          const bodyMatch =
            pageHtml.match(/class=["'][^"']*(?:rte|page-content|article-content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
            pageHtml.match(/<main[^>]*>([\s\S]*?)<\/main>/i);

          const bodyHtml = bodyMatch
            ? bodyMatch[1].trim()
            : `<p>Welcome to our ${title} page. We are dedicated to providing the best service and experience to our customers.</p>`;

          pages.push({
            title,
            handle,
            url: `/pages/${handle}`,
            bodyHtml,
          });
        }
      } catch (err) {
        this.logger.warn(`Could not fetch page ${handle}: ${err.message}`);
      }
    }

    return pages;
  }

  private async extractPolicies(html: string, domain: string): Promise<ScrapedPolicy[]> {
    const policyTypes: Array<{ type: ScrapedPolicy['type']; handle: string; defaultTitle: string }> = [
      { type: 'refund', handle: 'refund-policy', defaultTitle: 'Refund Policy' },
      { type: 'privacy', handle: 'privacy-policy', defaultTitle: 'Privacy Policy' },
      { type: 'shipping', handle: 'shipping-policy', defaultTitle: 'Shipping Policy' },
      { type: 'terms', handle: 'terms-of-service', defaultTitle: 'Terms of Service' },
    ];

    const policies: ScrapedPolicy[] = [];

    for (const p of policyTypes) {
      try {
        const policyUrl = `https://${domain}/policies/${p.handle}`;
        const res = await fetch(policyUrl, {
          headers: { 'User-Agent': this.userAgent },
        });
        if (res.ok) {
          const policyHtml = await res.text();
          const bodyMatch =
            policyHtml.match(/class=["'][^"']*(?:shopify-policy__body|rte)[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) ||
            policyHtml.match(/<main[^>]*>([\s\S]*?)<\/main>/i);

          const bodyHtml = bodyMatch
            ? bodyMatch[1].trim()
            : `<p>Standard ${p.defaultTitle} terms and conditions.</p>`;

          policies.push({
            type: p.type,
            title: p.defaultTitle,
            url: `/policies/${p.handle}`,
            bodyHtml,
          });
        }
      } catch (err) {
        this.logger.warn(`Could not fetch policy ${p.handle}: ${err.message}`);
      }
    }

    return policies;
  }

  private extractCdnImages(html: string, domain: string): string[] {
    const imgRegex = /(?:src|srcset)=["']([^"']+)["']/gi;
    const cdnImages = new Set<string>();
    let m;
    while ((m = imgRegex.exec(html)) !== null) {
      const parts = m[1].split(',');
      for (const p of parts) {
        const rawUrl = p.trim().split(' ')[0];
        if (rawUrl.includes('/files/') || rawUrl.includes('cdn/shop')) {
          cdnImages.add(this.formatUrl(rawUrl, domain));
        }
      }
    }
    return [...cdnImages].filter(u => /\.(jpe?g|png|webp|svg)/i.test(u));
  }

  private formatUrl(url: string, domain: string): string {
    let clean = url.trim();
    if (clean.startsWith('//')) {
      return 'https:' + clean;
    }
    if (clean.startsWith('/')) {
      return `https://${domain}${clean}`;
    }
    return clean;
  }
}
