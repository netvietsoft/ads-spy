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
    zip.addFile('sections/newsletter-popup.liquid', Buffer.from(this.generateNewsletterPopupSection(blueprint), 'utf-8'));

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

  async downloadBinary(url: string): Promise<Buffer | null> {
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

  generateBaseCss(blueprint: StorefrontBlueprint): string {
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

/* Product Grid & Cards */
.product-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 1.75rem;
  margin: 2rem 0;
}
.product-card {
  background: var(--color-background);
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 15px rgba(0, 0, 0, 0.04);
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}
.product-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
}
.product-card__image-wrapper {
  position: relative;
  display: block;
  aspect-ratio: 1/1;
  overflow: hidden;
  background: #f1f5f9;
}
.product-card__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s ease;
}
.product-card:hover .product-card__image {
  transform: scale(1.05);
}
.product-card__badge {
  position: absolute;
  top: 10px;
  left: 10px;
  background: #EF4444;
  color: #FFF;
  font-size: 0.75rem;
  font-weight: 800;
  padding: 0.2rem 0.6rem;
  border-radius: 4px;
}
.product-card__info {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  flex: 1;
}
.product-card__vendor {
  font-size: 0.75rem;
  text-transform: uppercase;
  color: #64748B;
  letter-spacing: 0.05em;
  margin-bottom: 0.25rem;
}
.product-card__title {
  font-size: 0.95rem;
  font-weight: 600;
  margin: 0 0 0.5rem 0;
  line-height: 1.4;
  flex: 1;
}
.product-card__title a {
  color: var(--color-foreground);
  text-decoration: none;
}
.product-card__title a:hover {
  color: var(--color-button);
}
.product-card__price {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
.price-current {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--color-foreground);
}
.price-compare {
  font-size: 0.9rem;
  color: #94A3B8;
  text-decoration: line-through;
}
.product-card__add-btn {
  width: 100%;
  padding: 0.65rem 1rem;
  background: var(--color-button, #10B981);
  color: var(--color-button-text, #000);
  border: none;
  border-radius: 6px;
  font-weight: 700;
  font-size: 0.85rem;
  cursor: pointer;
  transition: opacity 0.2s ease;
}
.product-card__add-btn:hover {
  opacity: 0.9;
}

/* Product Detail Page */
.product-detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3.5rem;
  align-items: start;
}
@media (max-width: 768px) {
  .product-detail-grid { grid-template-columns: 1fr; gap: 2rem; }
}
.product-detail__main-img {
  width: 100%;
  border-radius: 12px;
  object-fit: cover;
  border: 1px solid rgba(0, 0, 0, 0.08);
}
.product-detail__thumbnails {
  display: flex;
  gap: 0.75rem;
  margin-top: 1rem;
  overflow-x: auto;
}
.product-detail__thumb {
  width: 70px;
  height: 70px;
  border-radius: 6px;
  object-fit: cover;
  cursor: pointer;
  border: 2px solid transparent;
}
.product-detail__thumb:hover {
  border-color: #38BDF8;
}
.product-detail__title {
  font-size: 2rem;
  font-weight: 800;
  margin: 0.25rem 0 1rem 0;
  line-height: 1.3;
}
.product-detail__select, .product-detail__qty {
  padding: 0.75rem 1rem;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.15);
  background: #FFF;
  color: var(--color-foreground);
  font-size: 0.95rem;
  outline: none;
  width: 100%;
}
.product-detail__qty { width: 90px; text-align: center; }
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
    {% section 'newsletter-popup' %}
    {{ 'global.js' | asset_url | script_tag }}
  </body>
</html>
`;
  }

  generateSettingsSchema(): any[] {
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

  generateSettingsData(blueprint: StorefrontBlueprint): any {
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

  generateIndexJson(blueprint: StorefrontBlueprint): any {
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

  generateAnnouncementBarSection(): string {
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

  generateHeaderSection(blueprint: StorefrontBlueprint): string {
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

  generateImageBannerSection(): string {
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

  generateCollectionListSection(): string {
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

  generateFeaturedCollectionSection(): string {
    return `{% assign selected_collection = collections[section.settings.collection] %}
{% if selected_collection == blank or selected_collection.products_count == 0 %}
  {% assign selected_collection = collections['all'] %}
{% endif %}
{% if selected_collection == blank or selected_collection.products_count == 0 %}
  {% for col in collections %}
    {% if col.products_count > 0 %}
      {% assign selected_collection = col %}
      {% break %}
    {% endif %}
  {% endfor %}
{% endif %}

<div class="page-width" style="padding: 3.5rem 1.5rem;">
  <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 2rem; flex-wrap: wrap; gap: 1rem;">
    <div>
      <h2 style="font-size: 2rem; font-weight: 800; margin: 0 0 0.5rem 0;">{{ section.settings.title }}</h2>
      <p style="color: #64748B; margin: 0;">{{ section.settings.description | default: "Trending styles and customer favorites." }}</p>
    </div>
    <a href="{{ selected_collection.url | default: '/collections/all' }}" class="banner__btn" style="padding: 0.6rem 1.25rem; font-size: 0.9rem;">View All Products</a>
  </div>

  <div class="product-grid" id="FeaturedCollectionGrid">
    {% for product in selected_collection.products limit: section.settings.products_to_show %}
      <div class="product-card">
        <a href="{{ product.url }}" class="product-card__image-wrapper">
          {% if product.featured_image %}
            <img src="{{ product.featured_image | image_url: width: 600 }}" alt="{{ product.title | escape }}" loading="lazy" class="product-card__image">
          {% else %}
            <div class="product-card__placeholder" style="display:flex; align-items:center; justify-content:center; height:100%; background:#f1f5f9; color:#94A3B8;">No image</div>
          {% endif %}
          {% if product.compare_at_price > product.price %}
            <span class="product-card__badge">SALE</span>
          {% endif %}
        </a>
        <div class="product-card__info">
          {% if product.vendor != blank %}
            <span class="product-card__vendor">{{ product.vendor }}</span>
          {% endif %}
          <h3 class="product-card__title">
            <a href="{{ product.url }}">{{ product.title }}</a>
          </h3>
          <div class="product-card__price">
            <span class="price-current">{{ product.price | money }}</span>
            {% if product.compare_at_price > product.price %}
              <span class="price-compare">{{ product.compare_at_price | money }}</span>
            {% endif %}
          </div>
          <form action="/cart/add" method="post" class="product-card__form">
            <input type="hidden" name="id" value="{{ product.variants.first.id }}">
            <button type="submit" class="product-card__add-btn">Add to Cart</button>
          </form>
        </div>
      </div>
    {% else %}
      <div id="FeaturedGridFallback" style="grid-column: 1/-1; display: contents;"></div>
      <script>
      (function() {
        fetch('/products.json?limit={{ section.settings.products_to_show | default: 12 }}')
          .then(function(res) { return res.json(); })
          .then(function(data) {
            var container = document.getElementById('FeaturedGridFallback');
            if (!container || !data.products || data.products.length === 0) return;
            var html = '';
            var curr = (window.Shopify && Shopify.currency && Shopify.currency.active) || '₫';
            data.products.forEach(function(p) {
              var img = (p.images && p.images.length > 0) ? p.images[0].src : '';
              var v = (p.variants && p.variants.length > 0) ? p.variants[0] : {};
              var priceNum = Number(v.price || 0);
              var compNum = Number(v.compare_at_price || 0);
              var priceStr = priceNum.toLocaleString() + ' ' + curr;
              var compStr = compNum > priceNum ? (compNum.toLocaleString() + ' ' + curr) : '';

              html += '<div class="product-card">';
              html += '  <a href="/products/' + p.handle + '" class="product-card__image-wrapper">';
              if (img) {
                html += '    <img src="' + img + '" alt="' + (p.title || '') + '" loading="lazy" class="product-card__image">';
              } else {
                html += '    <div class="product-card__placeholder" style="display:flex; align-items:center; justify-content:center; height:100%; background:#f1f5f9; color:#94A3B8;">No image</div>';
              }
              if (compStr) {
                html += '    <span class="product-card__badge">SALE</span>';
              }
              html += '  </a>';
              html += '  <div class="product-card__info">';
              if (p.vendor) {
                html += '    <span class="product-card__vendor">' + p.vendor + '</span>';
              }
              html += '    <h3 class="product-card__title"><a href="/products/' + p.handle + '">' + p.title + '</a></h3>';
              html += '    <div class="product-card__price">';
              html += '      <span class="price-current">' + priceStr + '</span>';
              if (compStr) {
                html += '      <span class="price-compare">' + compStr + '</span>';
              }
              html += '    </div>';
              html += '    <form action="/cart/add" method="post" class="product-card__form">';
              html += '      <input type="hidden" name="id" value="' + (v.id || '') + '">';
              html += '      <button type="submit" class="product-card__add-btn">Add to Cart</button>';
              html += '    </form>';
              html += '  </div>';
              html += '</div>';
            });
            container.innerHTML = html;
          })
          .catch(function(e) { console.error('Product fallback error:', e); });
      })();
      </script>
    {% endfor %}
  </div>
</div>

{% schema %}
{
  "name": "Featured collection",
  "settings": [
    { "type": "text", "id": "title", "label": "Title", "default": "Best Sellers" },
    { "type": "text", "id": "description", "label": "Description", "default": "Customer favorite hoodies, tees & accessories." },
    { "type": "collection", "id": "collection", "label": "Collection", "default": "all" },
    { "type": "range", "id": "products_to_show", "label": "Products to show", "min": 4, "max": 48, "step": 4, "default": 24 }
  ]
}
{% endschema %}
`;
  }

  generateFooterSection(blueprint: StorefrontBlueprint): string {
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

  generateNewsletterPopupSection(blueprint: StorefrontBlueprint): string {
    return `{% if section.settings.enable_popup %}
<div id="NewsletterPopupModal" class="newsletter-popup-modal" style="display: none;">
  <div class="newsletter-popup-backdrop" onclick="closeNewsletterPopup()"></div>
  <div class="newsletter-popup-content">
    <button type="button" class="newsletter-popup-close" onclick="closeNewsletterPopup()">&times;</button>
    <div class="newsletter-popup-inner">
      {% if section.settings.badge != blank %}
        <span class="newsletter-popup-badge">{{ section.settings.badge }}</span>
      {% endif %}
      <h2 class="newsletter-popup-title">{{ section.settings.heading }}</h2>
      <p class="newsletter-popup-desc">{{ section.settings.subheading }}</p>

      <div class="newsletter-popup-coupon-box">
        <span class="coupon-code" id="popupCouponCode">{{ section.settings.coupon_code }}</span>
        <button type="button" class="copy-coupon-btn" onclick="copyPopupCoupon()">Copy Code</button>
      </div>

      <form action="/contact#contact_form" method="post" class="newsletter-popup-form" onsubmit="handlePopupSubmit(event)">
        <input type="email" name="contact[email]" placeholder="{{ section.settings.email_placeholder }}" required class="newsletter-popup-input">
        <button type="submit" class="newsletter-popup-submit">{{ section.settings.button_text }}</button>
      </form>
      <p class="newsletter-popup-footer-text">{{ section.settings.footer_text }}</p>
    </div>
  </div>
</div>

<style>
.newsletter-popup-modal {
  position: fixed;
  top: 0; left: 0; width: 100vw; height: 100vh;
  z-index: 999999;
  display: flex;
  align-items: center;
  justify-content: center;
}
.newsletter-popup-backdrop {
  position: absolute;
  top: 0; left: 0; width: 100%; height: 100%;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
}
.newsletter-popup-content {
  position: relative;
  background: #111827;
  color: #FFFFFF;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 16px;
  max-width: 460px;
  width: 90%;
  padding: 2.25rem 2rem;
  box-shadow: 0 25px 60px rgba(0, 0, 0, 0.7);
  text-align: center;
  z-index: 2;
  animation: popupFadeIn 0.3s ease-out;
}
@keyframes popupFadeIn {
  from { opacity: 0; transform: scale(0.92) translateY(10px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
.newsletter-popup-close {
  position: absolute;
  top: 12px; right: 16px;
  background: none; border: none;
  font-size: 28px; line-height: 1;
  color: #94A3B8; cursor: pointer;
}
.newsletter-popup-close:hover { color: #FFF; }
.newsletter-popup-badge {
  display: inline-block;
  background: #EF4444; color: #FFF;
  font-size: 0.75rem; font-weight: 800;
  text-transform: uppercase;
  padding: 0.25rem 0.75rem;
  border-radius: 999px;
  margin-bottom: 0.75rem;
  letter-spacing: 0.05em;
}
.newsletter-popup-title {
  font-size: 1.4rem;
  font-weight: 800;
  margin: 0 0 0.5rem 0;
  color: #FFFFFF;
  line-height: 1.25;
}
.newsletter-popup-desc {
  font-size: 0.875rem;
  color: #CBD5E1;
  margin: 0 0 1.25rem 0;
  line-height: 1.5;
}
.newsletter-popup-coupon-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(255, 255, 255, 0.08);
  border: 1px dashed #38BDF8;
  border-radius: 8px;
  padding: 0.6rem 1rem;
  margin-bottom: 1.25rem;
}
.coupon-code {
  font-family: monospace;
  font-size: 1.15rem;
  font-weight: 700;
  color: #38BDF8;
  letter-spacing: 0.1em;
}
.copy-coupon-btn {
  background: #38BDF8;
  color: #000;
  border: none;
  border-radius: 6px;
  padding: 0.35rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
}
.newsletter-popup-form {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}
.newsletter-popup-input {
  flex: 1;
  padding: 0.65rem 1rem;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #FFF;
  font-size: 0.85rem;
  outline: none;
}
.newsletter-popup-submit {
  padding: 0.65rem 1.25rem;
  background: #10B981;
  color: #000;
  border: none;
  border-radius: 8px;
  font-weight: 700;
  font-size: 0.85rem;
  cursor: pointer;
  white-space: nowrap;
}
.newsletter-popup-footer-text {
  font-size: 0.75rem;
  color: #64748B;
  margin: 0;
}
</style>

<script>
function initNewsletterPopup() {
  var popup = document.getElementById('NewsletterPopupModal');
  if (!popup) return;
  var dismissed = sessionStorage.getItem('popup_dismissed');
  if (!dismissed) {
    setTimeout(function() {
      popup.style.display = 'flex';
    }, {{ section.settings.delay_seconds | default: 3 }} * 1000);
  }
}
function closeNewsletterPopup() {
  var popup = document.getElementById('NewsletterPopupModal');
  if (popup) popup.style.display = 'none';
  sessionStorage.setItem('popup_dismissed', 'true');
}
function copyPopupCoupon() {
  var code = document.getElementById('popupCouponCode');
  if (code) {
    navigator.clipboard.writeText(code.innerText).then(function() {
      alert('Đã copy mã giảm giá: ' + code.innerText);
    });
  }
}
function handlePopupSubmit(e) {
  sessionStorage.setItem('popup_dismissed', 'true');
  alert('Cảm ơn bạn! Hãy dùng mã giảm giá khi thanh toán.');
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNewsletterPopup);
} else {
  initNewsletterPopup();
}
</script>
{% endif %}

{% schema %}
{
  "name": "Newsletter Popup",
  "settings": [
    { "type": "checkbox", "id": "enable_popup", "label": "Bật Popup", "default": true },
    { "type": "text", "id": "badge", "label": "Huy hiệu", "default": "ƯU ĐÃI ĐẶC BIỆT" },
    { "type": "text", "id": "heading", "label": "Tiêu đề", "default": "GIẢM 15% CHO ĐƠN ĐẦU TIÊN" },
    { "type": "textarea", "id": "subheading", "label": "Mô tả", "default": "Đăng ký nhận mã giảm giá 15% độc quyền và cập nhật các mẫu mới nhất." },
    { "type": "text", "id": "coupon_code", "label": "Mã Coupon", "default": "WELCOME15" },
    { "type": "text", "id": "email_placeholder", "label": "Placeholder email", "default": "Nhập email của bạn..." },
    { "type": "text", "id": "button_text", "label": "Nút gửi", "default": "NHẬN MÃ 15%" },
    { "type": "text", "id": "footer_text", "label": "Ghi chú chân trang", "default": "Cam kết bảo mật thông tin, có thể hủy bất cứ lúc nào." },
    { "type": "range", "id": "delay_seconds", "label": "Thời gian trễ (giây)", "min": 1, "max": 10, "step": 1, "default": 2 }
  ]
}
{% endschema %}
`;
  }

  generateMainPageSection(): string {
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

  generateProductLiquid(): string {
    return `<div class="page-width" style="padding: 4rem 1.5rem;">
  <div class="product-detail-grid">
    <div class="product-detail__media">
      {% if product.featured_image %}
        <img src="{{ product.featured_image | image_url: width: 1000 }}" alt="{{ product.title | escape }}" class="product-detail__main-img" id="ProductMainImage">
      {% endif %}
      {% if product.images.size > 1 %}
        <div class="product-detail__thumbnails">
          {% for image in product.images %}
            <img src="{{ image | image_url: width: 150 }}" alt="{{ product.title | escape }}" class="product-detail__thumb" onclick="document.getElementById('ProductMainImage').src='{{ image | image_url: width: 1000 }}'">
          {% endfor %}
        </div>
      {% endif %}
    </div>

    <div class="product-detail__info">
      {% if product.vendor != blank %}
        <span class="product-card__vendor">{{ product.vendor }}</span>
      {% endif %}
      <h1 class="product-detail__title">{{ product.title }}</h1>
      <div class="product-detail__price">
        <span class="price-current" style="font-size: 1.5rem;">{{ product.price | money }}</span>
        {% if product.compare_at_price > product.price %}
          <span class="price-compare" style="font-size: 1.25rem;">{{ product.compare_at_price | money }}</span>
        {% endif %}
      </div>

      <form action="/cart/add" method="post" class="product-detail__form">
        {% if product.variants.size > 1 %}
          <div style="margin-bottom: 1.25rem;">
            <label style="display: block; font-weight: 600; margin-bottom: 0.5rem;">Select Option / Variant:</label>
            <select name="id" class="product-detail__select">
              {% for variant in product.variants %}
                <option value="{{ variant.id }}" {% if variant == product.selected_or_first_available_variant %}selected="selected"{% endif %}>
                  {{ variant.title }} - {{ variant.price | money }}
                </option>
              {% endfor %}
            </select>
          </div>
        {% else %}
          <input type="hidden" name="id" value="{{ product.variants.first.id }}">
        {% endif %}

        <div style="display: flex; gap: 1rem; margin-bottom: 1.5rem;">
          <input type="number" name="quantity" value="1" min="1" class="product-detail__qty">
          <button type="submit" class="banner__btn" style="flex: 1; padding: 1rem; font-size: 1rem; font-weight: 700;">ADD TO CART</button>
        </div>
      </form>

      <div class="product-detail__desc rte">
        <h3 style="margin-bottom: 0.5rem;">Product Description</h3>
        {{ product.description }}
      </div>
    </div>
  </div>
</div>
`;
  }

  generateCollectionLiquid(): string {
    return `{% paginate collection.products by 24 %}
<div class="page-width" style="padding: 3rem 1.5rem;">
  <div style="margin-bottom: 2rem;">
    <h1 style="font-size: 2.25rem; font-weight: 800; margin: 0 0 0.5rem 0;">{{ collection.title }}</h1>
    {% if collection.description != blank %}
      <div class="rte" style="color: #64748B;">{{ collection.description }}</div>
    {% endif %}
    <p style="color: #94A3B8; font-size: 0.9rem; margin-top: 0.5rem;">Showing {{ collection.products_count }} products</p>
  </div>

  <div class="product-grid">
    {% for product in collection.products %}
      <div class="product-card">
        <a href="{{ product.url }}" class="product-card__image-wrapper">
          {% if product.featured_image %}
            <img src="{{ product.featured_image | image_url: width: 600 }}" alt="{{ product.title | escape }}" loading="lazy" class="product-card__image">
          {% else %}
            <div class="product-card__placeholder" style="display:flex; align-items:center; justify-content:center; height:100%; background:#f1f5f9; color:#94A3B8;">No image</div>
          {% endif %}
          {% if product.compare_at_price > product.price %}
            <span class="product-card__badge">SALE</span>
          {% endif %}
        </a>
        <div class="product-card__info">
          {% if product.vendor != blank %}
            <span class="product-card__vendor">{{ product.vendor }}</span>
          {% endif %}
          <h3 class="product-card__title">
            <a href="{{ product.url }}">{{ product.title }}</a>
          </h3>
          <div class="product-card__price">
            <span class="price-current">{{ product.price | money }}</span>
            {% if product.compare_at_price > product.price %}
              <span class="price-compare">{{ product.compare_at_price | money }}</span>
            {% endif %}
          </div>
          <form action="/cart/add" method="post" class="product-card__form">
            <input type="hidden" name="id" value="{{ product.variants.first.id }}">
            <button type="submit" class="product-card__add-btn">Add to Cart</button>
          </form>
        </div>
      </div>
    {% else %}
      <div id="CollectionGridFallback" style="grid-column: 1/-1; display: contents;"></div>
      <script>
      (function() {
        fetch('/products.json?limit=24')
          .then(function(res) { return res.json(); })
          .then(function(data) {
            var container = document.getElementById('CollectionGridFallback');
            if (!container || !data.products || data.products.length === 0) {
              container.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #64748B;">No products found in this collection. <a href="/collections/all" style="color:#38BDF8; font-weight:600;">View All Products</a></p>';
              return;
            }
            var html = '';
            var curr = (window.Shopify && Shopify.currency && Shopify.currency.active) || '₫';
            data.products.forEach(function(p) {
              var img = (p.images && p.images.length > 0) ? p.images[0].src : '';
              var v = (p.variants && p.variants.length > 0) ? p.variants[0] : {};
              var priceNum = Number(v.price || 0);
              var compNum = Number(v.compare_at_price || 0);
              var priceStr = priceNum.toLocaleString() + ' ' + curr;
              var compStr = compNum > priceNum ? (compNum.toLocaleString() + ' ' + curr) : '';

              html += '<div class="product-card">';
              html += '  <a href="/products/' + p.handle + '" class="product-card__image-wrapper">';
              if (img) {
                html += '    <img src="' + img + '" alt="' + (p.title || '') + '" loading="lazy" class="product-card__image">';
              } else {
                html += '    <div class="product-card__placeholder">No image</div>';
              }
              if (compStr) {
                html += '    <span class="product-card__badge">SALE</span>';
              }
              html += '  </a>';
              html += '  <div class="product-card__info">';
              if (p.vendor) {
                html += '    <span class="product-card__vendor">' + p.vendor + '</span>';
              }
              html += '    <h3 class="product-card__title"><a href="/products/' + p.handle + '">' + p.title + '</a></h3>';
              html += '    <div class="product-card__price">';
              html += '      <span class="price-current">' + priceStr + '</span>';
              if (compStr) {
                html += '      <span class="price-compare">' + compStr + '</span>';
              }
              html += '    </div>';
              html += '    <form action="/cart/add" method="post" class="product-card__form">';
              html += '      <input type="hidden" name="id" value="' + (v.id || '') + '">';
              html += '      <button type="submit" class="product-card__add-btn">Add to Cart</button>';
              html += '    </form>';
              html += '  </div>';
              html += '</div>';
            });
            container.innerHTML = html;
          })
          .catch(function(e) { console.error('Collection product fallback error:', e); });
      })();
      </script>
    {% endfor %}
  </div>

  {% if paginate.pages > 1 %}
    <div class="pagination" style="display: flex; justify-content: center; gap: 0.5rem; margin-top: 3rem;">
      {{ paginate | default_pagination }}
    </div>
  {% endif %}
</div>
{% endpaginate %}
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
