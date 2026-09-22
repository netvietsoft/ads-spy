import { Injectable, Logger } from '@nestjs/common';
import AdmZip from 'adm-zip';
import { StorefrontBlueprint } from './theme-cloner.types';

@Injectable()
export class ThemePackagerService {
  private readonly logger = new Logger(ThemePackagerService.name);

  async buildThemeZip(blueprint: StorefrontBlueprint): Promise<Buffer> {
    this.logger.log(`Building theme zip for ${blueprint.sourceDomain}`);
    const zip = new AdmZip();

    // 1. Download and inject hero banner and logo assets
    if (blueprint.heroBannerUrl) {
      try {
        const bannerBuf = await this.downloadBinary(blueprint.heroBannerUrl);
        if (bannerBuf) {
          zip.addFile('assets/hero-banner.jpg', bannerBuf);
        }
      } catch (err) {
        this.logger.warn(`Failed to download hero banner: ${err.message}`);
      }
    }

    if (blueprint.logoUrl) {
      try {
        const logoBuf = await this.downloadBinary(blueprint.logoUrl);
        if (logoBuf) {
          zip.addFile('assets/logo.png', logoBuf);
        }
      } catch (err) {
        this.logger.warn(`Failed to download logo: ${err.message}`);
      }
    }

    // 2. Base CSS with custom color scheme & fonts
    const baseCss = this.generateBaseCss(blueprint);
    zip.addFile('assets/base.css', Buffer.from(baseCss, 'utf-8'));
    zip.addFile('assets/global.js', Buffer.from(this.generateGlobalJs(), 'utf-8'));

    // 3. Layout: layout/theme.liquid
    const themeLiquid = this.generateThemeLiquid(blueprint);
    zip.addFile('layout/theme.liquid', Buffer.from(themeLiquid, 'utf-8'));

    // 4. Config: settings_schema.json & settings_data.json
    const settingsSchema = this.generateSettingsSchema();
    const settingsData = this.generateSettingsData(blueprint);
    zip.addFile('config/settings_schema.json', Buffer.from(JSON.stringify(settingsSchema, null, 2), 'utf-8'));
    zip.addFile('config/settings_data.json', Buffer.from(JSON.stringify(settingsData, null, 2), 'utf-8'));

    // 5. Templates: templates/index.json
    const indexJson = this.generateIndexJson(blueprint);
    zip.addFile('templates/index.json', Buffer.from(JSON.stringify(indexJson, null, 2), 'utf-8'));
    zip.addFile('templates/page.liquid', Buffer.from(this.generatePageLiquid(), 'utf-8'));
    zip.addFile('templates/product.liquid', Buffer.from(this.generateProductLiquid(), 'utf-8'));
    zip.addFile('templates/collection.liquid', Buffer.from(this.generateCollectionLiquid(), 'utf-8'));

    // 6. Sections
    zip.addFile('sections/announcement-bar.liquid', Buffer.from(this.generateAnnouncementBarSection(), 'utf-8'));
    zip.addFile('sections/header.liquid', Buffer.from(this.generateHeaderSection(blueprint), 'utf-8'));
    zip.addFile('sections/image-banner.liquid', Buffer.from(this.generateImageBannerSection(), 'utf-8'));
    zip.addFile('sections/collection-list.liquid', Buffer.from(this.generateCollectionListSection(), 'utf-8'));
    zip.addFile('sections/featured-collection.liquid', Buffer.from(this.generateFeaturedCollectionSection(), 'utf-8'));
    zip.addFile('sections/footer.liquid', Buffer.from(this.generateFooterSection(blueprint), 'utf-8'));
    zip.addFile('sections/main-page.liquid', Buffer.from(this.generateMainPageSection(), 'utf-8'));

    // 7. Locales
    zip.addFile('locales/en.default.json', Buffer.from(JSON.stringify(this.generateLocaleEn(), null, 2), 'utf-8'));

    // 8. Documentation / Readme inside Theme
    zip.addFile('README.md', Buffer.from(this.generateThemeReadme(blueprint), 'utf-8'));

    return zip.toBuffer();
  }

  async buildContentPackageZip(blueprint: StorefrontBlueprint): Promise<Buffer> {
    const zip = new AdmZip();

    // 1. Pages HTML
    for (const page of blueprint.pages) {
      zip.addFile(`pages/${page.handle}.html`, Buffer.from(page.bodyHtml || '', 'utf-8'));
    }

    // 2. Policies HTML
    for (const policy of blueprint.policies) {
      const filename = policy.url.split('/').pop() || `${policy.type}-policy`;
      zip.addFile(`policies/${filename}.html`, Buffer.from(policy.bodyHtml || '', 'utf-8'));
    }

    // 3. Menus JSON
    const menus = {
      headerMenu: blueprint.headerMenu,
      footerMenu: blueprint.footerMenu,
    };
    zip.addFile('navigation_menus.json', Buffer.from(JSON.stringify(menus, null, 2), 'utf-8'));

    // 4. Collections JSON
    zip.addFile('collections.json', Buffer.from(JSON.stringify(blueprint.collections, null, 2), 'utf-8'));

    // 5. Full Blueprint JSON
    zip.addFile('storefront_blueprint.json', Buffer.from(JSON.stringify(blueprint, null, 2), 'utf-8'));

    // 6. Instructions
    const instructions = `# Hướng dẫn cài đặt Nội dung cho Store mới

Dưới đây là toàn bộ nội dung đã bóc tách từ ${blueprint.sourceDomain}:
- **pages/**: Gồm ${blueprint.pages.length} trang (About Us, Contact, FAQs, Track Order, DCMA). Bạn có thể vào Shopify Admin > Online Store > Pages > Add page và dán mã HTML tương ứng.
- **policies/**: Gồm ${blueprint.policies.length} trang chính sách (Refund, Privacy, Shipping, Terms). Bạn có thể vào Shopify Admin > Settings > Policies để dán nội dung.
- **navigation_menus.json**: Cấu trúc Menu Header & Footer để tạo tại Online Store > Navigation.
- **collections.json**: Danh sách ${blueprint.collections.length} danh mục sản phẩm.
`;
    zip.addFile('INSTRUCTIONS.md', Buffer.from(instructions, 'utf-8'));

    return zip.toBuffer();
  }

  private async downloadBinary(url: string): Promise<Buffer | null> {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      },
    });
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private generateBaseCss(blueprint: StorefrontBlueprint): string {
    return `/* Cloned from ${blueprint.sourceDomain} - Shopify Dawn Theme 15.2 */
:root {
  --color-background: ${blueprint.colors.background};
  --color-foreground: ${blueprint.colors.foreground};
  --color-button: ${blueprint.colors.button};
  --color-button-text: ${blueprint.colors.buttonText};
  --color-secondary-button: ${blueprint.colors.secondaryButton};
  --color-secondary-button-text: ${blueprint.colors.secondaryButtonText};
  --color-contrast: ${blueprint.colors.contrast};
  --font-heading-family: '${blueprint.typography.headingFont}', sans-serif;
  --font-body-family: '${blueprint.typography.bodyFont}', sans-serif;
}

body {
  margin: 0;
  padding: 0;
  background-color: var(--color-background);
  color: var(--color-foreground);
  font-family: var(--font-body-family);
  line-height: 1.6;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-heading-family);
  color: var(--color-foreground);
  margin-top: 0;
}

.page-width {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 1.5rem;
}

/* Announcement bar */
.announcement-bar {
  background-color: var(--color-foreground);
  color: var(--color-background);
  text-align: center;
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  font-weight: 500;
}

/* Header */
.header-wrapper {
  border-bottom: 1px solid rgba(0,0,0,0.08);
  background: var(--color-background);
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 0;
}
.header__logo-img {
  max-height: 50px;
  width: auto;
  display: block;
}
.header__menu {
  display: flex;
  gap: 1.5rem;
  list-style: none;
  margin: 0;
  padding: 0;
}
.header__menu a {
  color: var(--color-foreground);
  text-decoration: none;
  font-weight: 500;
  transition: opacity 0.2s;
}
.header__menu a:hover {
  opacity: 0.7;
}

/* Banner */
.banner {
  position: relative;
  background: #111;
  color: #fff;
  min-height: 480px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  background-size: cover;
  background-position: center;
}
.banner__content {
  background: rgba(0, 0, 0, 0.45);
  padding: 3rem 2rem;
  border-radius: 8px;
  max-width: 700px;
}
.banner__btn {
  display: inline-block;
  background-color: var(--color-button);
  color: var(--color-button-text);
  padding: 0.85rem 2rem;
  border-radius: 4px;
  text-decoration: none;
  font-weight: 600;
  margin-top: 1.25rem;
  border: 1px solid var(--color-button-text);
}

/* Collections Grid */
.collection-list-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 1.5rem;
  margin: 2rem 0;
}
.collection-card {
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 6px;
  overflow: hidden;
  text-align: center;
  padding-bottom: 1rem;
}
.collection-card img {
  width: 100%;
  height: 220px;
  object-fit: cover;
}

/* Footer */
.footer {
  background: #f8f9fa;
  border-top: 1px solid rgba(0,0,0,0.08);
  padding: 3rem 0 1.5rem;
  margin-top: 4rem;
}
.footer-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 2rem;
  margin-bottom: 2rem;
}
.footer a {
  color: var(--color-foreground);
  text-decoration: none;
}
.footer a:hover {
  text-decoration: underline;
}
.footer__copyright {
  text-align: center;
  border-top: 1px solid rgba(0,0,0,0.06);
  padding-top: 1.5rem;
  font-size: 0.85rem;
  opacity: 0.8;
}
`;
  }

  private generateGlobalJs(): string {
    return `// Global storefront JS
document.addEventListener('DOMContentLoaded', () => {
  console.log('Storefront Theme loaded successfully.');
});
`;
  }

  private generateThemeLiquid(blueprint: StorefrontBlueprint): string {
    return `<!doctype html>
<html class="no-js" lang="en">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>{{ page_title }} - {{ shop.name }}</title>
    <meta name="description" content="{{ page_description | escape }}">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=${encodeURIComponent(
      blueprint.typography.headingFont,
    )}:wght@400;600;700&family=${encodeURIComponent(
      blueprint.typography.bodyFont,
    )}:wght@400;500;600&display=swap" rel="stylesheet">
    {{ 'base.css' | asset_url | stylesheet_tag }}
    {{ content_for_header }}
  </head>
  <body>
    {% section 'announcement-bar' %}
    {% section 'header' %}
    <main id="MainContent" class="content-for-layout focus-none" role="main" tabindex="-1">
      {{ content_for_layout }}
    </main>
    {% section 'footer' %}
    {{ 'global.js' | asset_url | script_tag }}
  </body>
</html>
`;
  }

  private generateSettingsSchema(): any[] {
    return [
      {
        name: 'theme_info',
        theme_name: 'Dawn Clone',
        theme_version: '15.2.0',
        theme_author: 'Google Ads Spy Engine',
        theme_documentation_url: 'https://help.shopify.com/manual/online-store/themes',
        theme_support_url: 'https://support.shopify.com',
      },
      {
        name: 'Colors',
        settings: [
          { type: 'color', id: 'colors_background_1', label: 'Background', default: '#FFFFFF' },
          { type: 'color', id: 'colors_text', label: 'Text', default: '#121212' },
          { type: 'color', id: 'colors_accent_1', label: 'Button Color', default: '#121212' },
          { type: 'color', id: 'colors_solid_button_labels', label: 'Button Text', default: '#FFFFFF' },
        ],
      },
    ];
  }

  private generateSettingsData(blueprint: StorefrontBlueprint): any {
    return {
      current: {
        colors_background_1: blueprint.colors.background,
        colors_text: blueprint.colors.foreground,
        colors_accent_1: blueprint.colors.button,
        colors_solid_button_labels: blueprint.colors.buttonText,
        colors_accent_2: blueprint.colors.secondaryButton,
        type_header_font: blueprint.typography.headingFont,
        type_body_font: blueprint.typography.bodyFont,
        sections: {
          'announcement-bar': {
            type: 'announcement-bar',
            settings: {
              text: blueprint.announcementBarText || 'Welcome to Our Store',
            },
          },
          header: {
            type: 'header',
            settings: {
              menu: 'main-menu',
            },
          },
          footer: {
            type: 'footer',
            settings: {
              menu: 'footer',
            },
          },
        },
      },
    };
  }

  private generateIndexJson(blueprint: StorefrontBlueprint): any {
    return {
      sections: {
        image_banner: {
          type: 'image-banner',
          settings: {
            heading: blueprint.title || 'Overtime Gearz Collection',
            subheading: 'Premium gear and stylish essentials tailored for your lifestyle.',
            button_label: blueprint.ctaText || 'Shop now',
            button_link: blueprint.ctaUrl || '/collections/all',
          },
        },
        collection_list: {
          type: 'collection-list',
          settings: {
            title: 'Featured Collections',
          },
          blocks: blueprint.collections.slice(0, 4).reduce((acc: any, c, idx) => {
            acc[`collection_${idx}`] = {
              type: 'featured_collection',
              settings: {
                collection: c.handle,
                title: c.title,
              },
            };
            return acc;
          }, {}),
          block_order: blueprint.collections.slice(0, 4).map((_, idx) => `collection_${idx}`),
        },
        featured_collection: {
          type: 'featured-collection',
          settings: {
            title: 'Best Sellers',
            collection: 'all',
            products_to_show: 8,
          },
        },
      },
      order: ['image_banner', 'collection_list', 'featured_collection'],
    };
  }

  private generateAnnouncementBarSection(): string {
    return `{% if section.settings.text != blank %}
<div class="announcement-bar">
  <p>{{ section.settings.text }}</p>
</div>
{% endif %}

{% schema %}
{
  "name": "Announcement bar",
  "settings": [
    {
      "type": "text",
      "id": "text",
      "label": "Text",
      "default": "Welcome to Our Store"
    }
  ]
}
{% endschema %}
`;
  }

  private generateHeaderSection(blueprint: StorefrontBlueprint): string {
    return `<header class="header-wrapper">
  <div class="page-width header">
    <a href="/" class="header__logo">
      <img src="{{ 'logo.png' | asset_url }}" alt="{{ shop.name }}" class="header__logo-img" onerror="this.style.display='none'">
      <h2 style="display:inline-block; vertical-align:middle; margin:0;">{{ shop.name }}</h2>
    </a>
    <nav>
      <ul class="header__menu">
        ${blueprint.headerMenu
          .map(
            m => `<li><a href="${m.url}">${m.title}</a></li>`,
          )
          .join('\n        ')}
      </ul>
    </nav>
  </div>
</header>

{% schema %}
{
  "name": "Header",
  "settings": [
    {
      "type": "link_list",
      "id": "menu",
      "label": "Menu",
      "default": "main-menu"
    }
  ]
}
{% endschema %}
`;
  }

  private generateImageBannerSection(): string {
    return `<div class="banner" style="background-image: url('{{ 'hero-banner.jpg' | asset_url }}');">
  <div class="banner__content">
    <h1>{{ section.settings.heading }}</h1>
    <p>{{ section.settings.subheading }}</p>
    {% if section.settings.button_label != blank %}
      <a href="{{ section.settings.button_link }}" class="banner__btn">{{ section.settings.button_label }}</a>
    {% endif %}
  </div>
</div>

{% schema %}
{
  "name": "Image banner",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Explore Exclusive Gear" },
    { "type": "text", "id": "subheading", "label": "Subheading", "default": "Discover trending items updated daily." },
    { "type": "text", "id": "button_label", "label": "Button label", "default": "Shop now" },
    { "type": "url", "id": "button_link", "label": "Button link", "default": "/collections/all" }
  ]
}
{% endschema %}
`;
  }

  private generateCollectionListSection(): string {
    return `<div class="page-width" style="padding: 3rem 1.5rem;">
  <h2>{{ section.settings.title }}</h2>
  <div class="collection-list-grid">
    {% for block in section.blocks %}
      <div class="collection-card">
        <h3>{{ block.settings.title }}</h3>
        <a href="/collections/{{ block.settings.collection }}" class="banner__btn" style="padding: 0.5rem 1rem;">View Collection</a>
      </div>
    {% endfor %}
  </div>
</div>

{% schema %}
{
  "name": "Collection list",
  "settings": [
    { "type": "text", "id": "title", "label": "Title", "default": "Collections" }
  ],
  "blocks": [
    {
      "type": "featured_collection",
      "name": "Collection",
      "settings": [
        { "type": "collection", "id": "collection", "label": "Collection" },
        { "type": "text", "id": "title", "label": "Title" }
      ]
    }
  ]
}
{% endschema %}
`;
  }

  private generateFeaturedCollectionSection(): string {
    return `<div class="page-width" style="padding: 3rem 1.5rem;">
  <h2>{{ section.settings.title }}</h2>
  <p>Shop our customer favorites with expedited shipping.</p>
  <div style="text-align: center; margin-top: 2rem;">
    <a href="/collections/all" class="banner__btn">View All Products</a>
  </div>
</div>

{% schema %}
{
  "name": "Featured collection",
  "settings": [
    { "type": "text", "id": "title", "label": "Title", "default": "Featured Products" }
  ]
}
{% endschema %}
`;
  }

  private generateFooterSection(blueprint: StorefrontBlueprint): string {
    return `<footer class="footer">
  <div class="page-width">
    <div class="footer-grid">
      <div>
        <h3>About {{ shop.name }}</h3>
        <p>Providing top-quality products with dedicated customer support worldwide.</p>
      </div>
      <div>
        <h3>Quick Links</h3>
        <ul style="list-style:none; padding:0; line-height:2;">
          ${blueprint.footerMenu
            .slice(0, 5)
            .map(m => `<li><a href="${m.url}">${m.title}</a></li>`)
            .join('\n          ')}
        </ul>
      </div>
      <div>
        <h3>Legal & Policies</h3>
        <ul style="list-style:none; padding:0; line-height:2;">
          ${blueprint.footerMenu
            .slice(5)
            .map(m => `<li><a href="${m.url}">${m.title}</a></li>`)
            .join('\n          ')}
        </ul>
      </div>
    </div>
    <div class="footer__copyright">
      &copy; {{ 'now' | date: "%Y" }}, {{ shop.name }}. All rights reserved. Powered by Shopify.
    </div>
  </div>
</footer>

{% schema %}
{
  "name": "Footer",
  "settings": []
}
{% endschema %}
`;
  }

  private generateMainPageSection(): string {
    return `<div class="page-width" style="padding: 4rem 1.5rem; max-width: 800px;">
  <h1>{{ page.title }}</h1>
  <div class="rte">
    {{ page.content }}
  </div>
</div>
`;
  }

  private generatePageLiquid(): string {
    return `{% section 'main-page' %}`;
  }

  private generateProductLiquid(): string {
    return `<div class="page-width" style="padding: 4rem 1.5rem;">
  <h1>{{ product.title }}</h1>
  <p>{{ product.price | money }}</p>
  <div class="rte">{{ product.description }}</div>
</div>
`;
  }

  private generateCollectionLiquid(): string {
    return `<div class="page-width" style="padding: 4rem 1.5rem;">
  <h1>{{ collection.title }}</h1>
  <p>{{ collection.description }}</p>
</div>
`;
  }

  private generateLocaleEn(): any {
    return {
      general: {
        share: {
          copy_to_clipboard: 'Copy link',
        },
      },
    };
  }

  private generateThemeReadme(blueprint: StorefrontBlueprint): string {
    return `# Shopify Dawn Cloned Theme (15.2.0)
**Source**: ${blueprint.sourceDomain}
**Generated on**: ${blueprint.analyzedAt}

### How to Install:
1. Go to your Shopify Admin.
2. Navigate to **Online Store > Themes**.
3. Under the **Theme library** section, click **Add theme > Upload zip file**.
4. Select this zip file and click **Upload file**.
5. Once uploaded, click **Actions > Publish** to make it your active storefront!
`;
  }
}
