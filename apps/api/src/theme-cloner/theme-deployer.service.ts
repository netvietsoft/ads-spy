import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ProductScraperService } from '../product-sync/product-scraper.service';
import { ProductTransformService } from '../product-sync/product-transform.service';
import { ShopifyPublisherService } from '../product-sync/shopify-publisher.service';
import { ThemePackagerService } from './theme-packager.service';
import {
  StorefrontBlueprint,
  ThemeDeployOptions,
  DeployResult,
  DeployStepLog,
} from './theme-cloner.types';

@Injectable()
export class ThemeDeployerService {
  private readonly logger = new Logger(ThemeDeployerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly productScraper: ProductScraperService,
    private readonly productTransform: ProductTransformService,
    private readonly shopifyPublisher: ShopifyPublisherService,
    private readonly packagerService: ThemePackagerService,
  ) {}

  async deploy(
    blueprint: StorefrontBlueprint,
    options: ThemeDeployOptions,
  ): Promise<DeployResult> {
    const logs: DeployStepLog[] = [];
    const createdPages: string[] = [];
    const createdPolicies: string[] = [];
    const createdCollections: string[] = [];
    const deployedAssets: string[] = [];

    const addLog = (
      step: string,
      status: DeployStepLog['status'],
      message: string,
      details?: any,
    ) => {
      logs.push({
        step,
        status,
        message,
        details,
        timestamp: new Date().toISOString(),
      });
      this.logger.log(`[Deploy ${step}] ${status.toUpperCase()}: ${message}`);
    };

    // 1. Resolve Target Store credentials
    let targetDomain = options.shopDomain || '';
    let accessToken = options.accessToken || '';

    if (options.targetStoreId) {
      try {
        const storeId = Number(options.targetStoreId);
        if (!isNaN(storeId)) {
          const store = await this.prisma.syncTargetStore.findUnique({
            where: { id: storeId },
          });
          if (store) {
            targetDomain = store.domain;
            accessToken = store.accessToken || '';
            addLog('Auth', 'success', `Using credentials from Target Store: ${store.name} (${store.domain})`);
          }
        }
      } catch (err) {
        addLog('Auth', 'failed', `Failed to load target store: ${err.message}`);
      }
    }

    if (!targetDomain || !accessToken) {
      addLog('Auth', 'failed', 'Missing Target Shopify Domain or Access Token.');
      return {
        success: false,
        targetDomain: targetDomain || 'unknown',
        logs,
        createdPages,
        createdPolicies,
        createdCollections,
        deployedAssets,
        error: 'Missing Target Shopify Domain or Access Token',
      };
    }

    // Clean domain
    targetDomain = targetDomain.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
    if (targetDomain.includes('@')) {
      const emailEntered = targetDomain;
      addLog('Auth', 'failed', `Lỗi tên miền shop: "${emailEntered}" là địa chỉ Email, không phải tên miền Shopify.`);
      return {
        success: false,
        targetDomain,
        logs,
        createdPages,
        createdPolicies,
        createdCollections,
        deployedAssets,
        error: `Tên miền Shop không hợp lệ: "${emailEntered}". Bạn đang nhập địa chỉ email thay vì tên miền Shopify (ví dụ: your-store.myshopify.com). Vui lòng vào trang quản trị Shopify (Shopify Admin > Settings > Domains) để xem đúng tên miền .myshopify.com của cửa hàng.`,
      };
    }

    if (!targetDomain.includes('.myshopify.com')) {
      targetDomain = `${targetDomain}.myshopify.com`;
    }

    const apiBase = `https://${targetDomain}/admin/api/2024-01`;
    const headers = {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    };

    // Verify connection
    try {
      const shopRes = await fetch(`${apiBase}/shop.json`, { headers });
      if (!shopRes.ok) {
        throw new Error(`Authentication failed with HTTP ${shopRes.status}`);
      }
      const shopData = await shopRes.json();
      addLog('Auth', 'success', `Connected to Shopify Store: ${shopData.shop?.name || targetDomain}`);
    } catch (err) {
      addLog('Auth', 'failed', `Cannot connect to Shopify Admin: ${err.message}`);
      return {
        success: false,
        targetDomain,
        logs,
        createdPages,
        createdPolicies,
        createdCollections,
        deployedAssets,
        error: err.message,
      };
    }

    // 2. Deploy Pages
    if (options.deployPages !== false) {
      addLog('Pages', 'in_progress', `Deploying ${blueprint.pages.length} Pages...`);
      for (const page of blueprint.pages) {
        try {
          const res = await fetch(`${apiBase}/pages.json`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              page: {
                title: page.title,
                handle: page.handle,
                body_html: page.bodyHtml,
                published: true,
              },
            }),
          });
          if (res.ok) {
            createdPages.push(page.title);
            addLog('Pages', 'success', `Created page: ${page.title} (/pages/${page.handle})`);
          } else {
            const errData = await res.json();
            addLog('Pages', 'failed', `Page ${page.title} returned error: ${JSON.stringify(errData.errors || errData)}`);
          }
        } catch (err) {
          addLog('Pages', 'failed', `Failed to create page ${page.title}: ${err.message}`);
        }
        await this.delay(100);
      }
    }

    // 3. Deploy Policies (as Pages for 100% reliability and custom styling)
    if (options.deployPolicies !== false) {
      addLog('Policies', 'in_progress', `Deploying ${blueprint.policies.length} Policies...`);
      for (const policy of blueprint.policies) {
        const handle = policy.url.split('/').pop() || `${policy.type}-policy`;
        try {
          const res = await fetch(`${apiBase}/pages.json`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              page: {
                title: policy.title,
                handle: handle,
                body_html: policy.bodyHtml,
                published: true,
              },
            }),
          });
          if (res.ok) {
            createdPolicies.push(policy.title);
            addLog('Policies', 'success', `Created policy page: ${policy.title} (/pages/${handle})`);
          } else {
            const errData = await res.json();
            addLog('Policies', 'failed', `Policy ${policy.title} returned: ${JSON.stringify(errData.errors || errData)}`);
          }
        } catch (err) {
          addLog('Policies', 'failed', `Failed to create policy ${policy.title}: ${err.message}`);
        }
        await this.delay(100);
      }
    }

    // 4. Deploy Collections
    if (options.deployCollections !== false) {
      addLog('Collections', 'in_progress', `Deploying ${blueprint.collections.length} Collections...`);
      for (const col of blueprint.collections) {
        try {
          const body: any = {
            custom_collection: {
              title: col.title,
              handle: col.handle,
              published: true,
            },
          };
          if (col.imageUrl) {
            body.custom_collection.image = { src: col.imageUrl };
          }
          const res = await fetch(`${apiBase}/custom_collections.json`, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
          });
          if (res.ok) {
            createdCollections.push(col.title);
            addLog('Collections', 'success', `Created collection: ${col.title} (/collections/${col.handle})`);
          } else {
            const errData = await res.json();
            addLog('Collections', 'failed', `Collection ${col.title} returned: ${JSON.stringify(errData.errors || errData)}`);
          }
        } catch (err) {
          addLog('Collections', 'failed', `Failed to create collection ${col.title}: ${err.message}`);
        }
        await this.delay(100);
      }
    }

    // 5. Deploy Theme Assets, Banners, Popup & Sections
    if (options.deployThemeAssets !== false) {
      addLog('ThemeAssets', 'in_progress', 'Đang thiết lập Theme Dawn 15.2, Banner HD, Logo, Popup Giảm Giá và Lưới Sản Phẩm...');
      try {
        let themeId = options.themeId;
        if (!themeId) {
          const themesRes = await fetch(`${apiBase}/themes.json`, { headers });
          if (themesRes.ok) {
            const themesData = await themesRes.json();
            const mainTheme = themesData.themes?.find((t: any) => t.role === 'main') || themesData.themes?.[0];
            if (mainTheme) {
              themeId = mainTheme.id;
              addLog('ThemeAssets', 'success', `Tìm thấy Theme đang kích hoạt: "${mainTheme.name}" (ID: ${themeId})`);
            }
          }
        }

        if (themeId) {
          // Đảm bảo Smart Collection "All Products" (handle: all) tồn tại để chứa toàn bộ sản phẩm
          try {
            await fetch(`${apiBase}/smart_collections.json`, {
              method: 'POST',
              headers,
              body: JSON.stringify({
                smart_collection: {
                  title: 'All Products',
                  handle: 'all',
                  rules: [
                    {
                      column: 'variant_price',
                      relation: 'greater_than',
                      condition: '-1',
                    },
                  ],
                  published: true,
                },
              }),
            });
          } catch {}

          // 5.1 Push Hero banner HD
          if (blueprint.heroBannerUrl) {
            try {
              const bannerBuffer = await this.downloadBinary(blueprint.heroBannerUrl);
              if (bannerBuffer) {
                const b64 = bannerBuffer.toString('base64');
                const assetRes = await fetch(`${apiBase}/themes/${themeId}/assets.json`, {
                  method: 'PUT',
                  headers,
                  body: JSON.stringify({
                    asset: {
                      key: 'assets/hero-banner.jpg',
                      attachment: b64,
                    },
                  }),
                });
                if (assetRes.ok) {
                  deployedAssets.push('assets/hero-banner.jpg');
                  addLog('ThemeAssets', 'success', 'Đã tải và nạp Hero Banner HD vào assets/hero-banner.jpg');
                }
              }
            } catch (e) {
              addLog('ThemeAssets', 'failed', `Lỗi nạp Hero Banner: ${e.message}`);
            }
          }

          // 5.2 Push Logo
          if (blueprint.logoUrl) {
            try {
              const logoBuffer = await this.downloadBinary(blueprint.logoUrl);
              if (logoBuffer) {
                const b64 = logoBuffer.toString('base64');
                const assetRes = await fetch(`${apiBase}/themes/${themeId}/assets.json`, {
                  method: 'PUT',
                  headers,
                  body: JSON.stringify({
                    asset: {
                      key: 'assets/logo.png',
                      attachment: b64,
                    },
                  }),
                });
                if (assetRes.ok) {
                  deployedAssets.push('assets/logo.png');
                  addLog('ThemeAssets', 'success', 'Đã tải và nạp Logo Brand vào assets/logo.png');
                }
              }
            } catch (e) {
              addLog('ThemeAssets', 'failed', `Lỗi nạp Logo: ${e.message}`);
            }
          }

          // 5.3 Push Base CSS & Sections
          const sectionsToDeploy: Array<{ key: string; value: string; label: string }> = [
            {
              key: 'assets/base.css',
              value: this.packagerService.generateBaseCss(blueprint),
              label: 'Base Styling CSS',
            },
            {
              key: 'sections/image-banner.liquid',
              value: this.packagerService.generateImageBannerSection(),
              label: 'Hero Banner Section',
            },
            {
              key: 'sections/announcement-bar.liquid',
              value: this.packagerService.generateAnnouncementBarSection(),
              label: 'Announcement Bar Section',
            },
            {
              key: 'sections/newsletter-popup.liquid',
              value: this.packagerService.generateNewsletterPopupSection(blueprint),
              label: 'Discount & Newsletter Popup',
            },
            {
              key: 'sections/collection-list.liquid',
              value: this.packagerService.generateCollectionListSection(),
              label: 'Collection List Section',
            },
            {
              key: 'sections/featured-collection.liquid',
              value: this.packagerService.generateFeaturedCollectionSection(),
              label: 'Featured Products Grid Section',
            },
            {
              key: 'sections/header.liquid',
              value: this.packagerService.generateHeaderSection(blueprint),
              label: 'Header Section with Logo',
            },
            {
              key: 'sections/footer.liquid',
              value: this.packagerService.generateFooterSection(blueprint),
              label: 'Footer Section',
            },
            {
              key: 'templates/index.json',
              value: JSON.stringify(this.packagerService.generateIndexJson(blueprint), null, 2),
              label: 'Homepage Template (index.json)',
            },
            {
              key: 'templates/collection.liquid',
              value: this.packagerService.generateCollectionLiquid(),
              label: 'Collection Products Grid Template',
            },
            {
              key: 'templates/product.liquid',
              value: this.packagerService.generateProductLiquid(),
              label: 'Product Detail & Cart Template',
            },
            {
              key: 'config/settings_data.json',
              value: JSON.stringify(this.packagerService.generateSettingsData(blueprint), null, 2),
              label: 'Theme Settings Data',
            },
          ];

          for (const sec of sectionsToDeploy) {
            try {
              const secRes = await fetch(`${apiBase}/themes/${themeId}/assets.json`, {
                method: 'PUT',
                headers,
                body: JSON.stringify({
                  asset: {
                    key: sec.key,
                    value: sec.value,
                  },
                }),
              });
              if (secRes.ok) {
                deployedAssets.push(sec.key);
              }
            } catch (err) {
              this.logger.warn(`Could not deploy asset ${sec.key}: ${err.message}`);
            }
            await this.delay(80);
          }

          // Cố gắng chèn popup vào layout/theme.liquid nếu chưa có
          try {
            const themeLiquidRes = await fetch(`${apiBase}/themes/${themeId}/assets.json?asset[key]=layout/theme.liquid`, { headers });
            if (themeLiquidRes.ok) {
              const themeLiquidData = await themeLiquidRes.json();
              let content = themeLiquidData.asset?.value || '';
              if (content && !content.includes('newsletter-popup')) {
                content = content.replace('</body>', "{% section 'newsletter-popup' %}\n</body>");
                await fetch(`${apiBase}/themes/${themeId}/assets.json`, {
                  method: 'PUT',
                  headers,
                  body: JSON.stringify({
                    asset: {
                      key: 'layout/theme.liquid',
                      value: content,
                    },
                  }),
                });
                deployedAssets.push('layout/theme.liquid (popup injected)');
              }
            }
          } catch (e) {
            this.logger.warn(`Could not inject popup into theme.liquid: ${e.message}`);
          }

          addLog('ThemeAssets', 'success', `Đã đồng bộ toàn bộ giao diện: Banner HD, Logo, Popup Giảm Giá, và ${deployedAssets.length} thành phần giao diện & lưới sản phẩm!`);
        } else {
          addLog('ThemeAssets', 'skipped', 'Không tìm thấy theme hoạt động để nạp assets trực tiếp.');
        }
      } catch (err) {
        addLog('ThemeAssets', 'failed', `Lỗi thiết lập Theme: ${err.message}`);
      }
    }

    // 6. Deploy Products (Combo 1-Click)
    let totalProductsSynced = 0;
    if (options.deployProducts) {
      addLog('Products', 'in_progress', `Chuẩn bị danh mục sản phẩm từ ${blueprint.sourceDomain}...`);
      try {
        // Look up existing products in DB
        let products = await this.prisma.syncProduct.findMany({
          where: {
            sourceStore: {
              domain: { contains: blueprint.sourceDomain },
            },
          },
          take: options.productLimit && options.productLimit > 0 ? options.productLimit : 100,
        });

        // If not in DB yet, scrape live
        if (products.length === 0) {
          addLog('Products', 'in_progress', `Chưa có sẵn trong kho, đang quét cào trực tiếp từ ${blueprint.sourceDomain}...`);
          let sourceStore = await this.prisma.syncSourceStore.findFirst({
            where: { domain: { contains: blueprint.sourceDomain } },
          });
          if (!sourceStore) {
            sourceStore = await this.prisma.syncSourceStore.create({
              data: {
                name: blueprint.title || blueprint.sourceDomain,
                domain: blueprint.sourceDomain,
              },
            });
          }
          await this.productScraper.scrapeSourceStore(sourceStore.id, { maxPages: 2 });
          products = await this.prisma.syncProduct.findMany({
            where: { sourceStoreId: sourceStore.id },
            take: options.productLimit && options.productLimit > 0 ? options.productLimit : 100,
          });
        }

        addLog('Products', 'in_progress', `Tìm thấy ${products.length} sản phẩm. Bắt đầu đẩy sang Shop Đích...`);

        const transformConfig = {
          priceMultiplier: options.priceMultiplier !== undefined ? options.priceMultiplier : 1.25,
          priceAddition: options.priceAddition !== undefined ? options.priceAddition : 0,
          priceRounding: (options.priceRounding || '99') as any,
          overrideVendor: options.overrideVendor || undefined,
        };

        for (let i = 0; i < products.length; i++) {
          const rawP = products[i];
          const transformed = this.productTransform.transformProduct(rawP, transformConfig);

          let success = false;
          let retries = 0;

          while (!success && retries < 3) {
            try {
              const productRes = await fetch(`${apiBase}/products.json`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ product: transformed }),
              });

              if (productRes.ok) {
                totalProductsSynced++;
                success = true;
                if (i % 10 === 0 || i === products.length - 1) {
                  addLog('Products', 'in_progress', `Đã đẩy ${totalProductsSynced}/${products.length} sản phẩm: "${transformed.title}"`);
                }
              } else if (productRes.status === 429) {
                const retryAfterSec = parseFloat(productRes.headers.get('Retry-After') || '2');
                this.logger.warn(`Shopify 429 rate limit. Waiting ${retryAfterSec}s before retrying product ${rawP.title}...`);
                await this.delay(Math.max(retryAfterSec * 1000, 1500));
                retries++;
              } else {
                const errData: any = await productRes.json().catch(() => ({}));
                const errStr = typeof errData?.errors === 'string' ? errData.errors : JSON.stringify(errData);
                this.logger.warn(`Failed to push product ${rawP.title}: ${errStr}`);
                if (i === 0) {
                  addLog('Products', 'failed', `Lỗi đẩy sản phẩm mẫu: ${errStr}`);
                }
                if (errStr.includes('merchant approval') || errStr.includes('scope')) {
                  addLog('Products', 'failed', `Dừng đồng bộ: App chưa được cấp quyền write_products trên Shopify. Chi tiết: ${errStr}`);
                  break;
                }
                break;
              }
            } catch (e) {
              this.logger.warn(`Push product error: ${e.message}`);
              retries++;
              await this.delay(1000);
            }
          }
          await this.delay(200); // 5 req/s fast burst within Shopify limits
        }

        addLog('Products', 'success', `Đồng bộ thành công ${totalProductsSynced}/${products.length} sản phẩm sang Shop Đích!`);
      } catch (err) {
        addLog('Products', 'failed', `Lỗi đồng bộ sản phẩm: ${err.message}`);
      }
    }

    const shopName = targetDomain.replace('.myshopify.com', '');
    const shopifyAdminUrl = `https://admin.shopify.com/store/${shopName}/products`;

    addLog('Summary', 'success', `🎉 BẤM PHÁT ĂN TẤT THÀNH CÔNG! Đã tạo Theme Assets, ${createdPages.length} trang, ${createdPolicies.length} chính sách, ${createdCollections.length} danh mục, ${totalProductsSynced} sản phẩm.`);

    return {
      success: true,
      targetDomain,
      shopifyAdminUrl,
      logs,
      createdPages,
      createdPolicies,
      createdCollections,
      deployedAssets,
      totalProductsSynced,
    };
  }

  private async downloadBinary(url: string): Promise<Buffer | null> {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        },
      });
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    } catch {
      return null;
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
