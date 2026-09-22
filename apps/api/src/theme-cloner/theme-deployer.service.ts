import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ProductScraperService } from '../product-sync/product-scraper.service';
import { ProductTransformService } from '../product-sync/product-transform.service';
import { ShopifyPublisherService } from '../product-sync/shopify-publisher.service';
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
    targetDomain = targetDomain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
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
        await this.delay(300);
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
        await this.delay(300);
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
        await this.delay(300);
      }
    }

    // 5. Deploy Theme Assets (Banner & Logo)
    if (options.deployThemeAssets !== false) {
      addLog('ThemeAssets', 'in_progress', 'Locating active theme on Target Store...');
      try {
        let themeId = options.themeId;
        if (!themeId) {
          const themesRes = await fetch(`${apiBase}/themes.json`, { headers });
          if (themesRes.ok) {
            const themesData = await themesRes.json();
            const mainTheme = themesData.themes?.find((t: any) => t.role === 'main') || themesData.themes?.[0];
            if (mainTheme) {
              themeId = mainTheme.id;
              addLog('ThemeAssets', 'success', `Found main active theme: "${mainTheme.name}" (ID: ${themeId})`);
            }
          }
        }

        if (themeId) {
          // Push Hero banner
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
                  addLog('ThemeAssets', 'success', 'Uploaded Hero Banner to theme assets/hero-banner.jpg');
                }
              }
            } catch (e) {
              addLog('ThemeAssets', 'failed', `Failed to upload hero banner: ${e.message}`);
            }
          }

          // Push Logo
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
                  addLog('ThemeAssets', 'success', 'Uploaded Logo to theme assets/logo.png');
                }
              }
            } catch (e) {
              addLog('ThemeAssets', 'failed', `Failed to upload logo: ${e.message}`);
            }
          }
        } else {
          addLog('ThemeAssets', 'skipped', 'No active theme found to push assets directly.');
        }
      } catch (err) {
        addLog('ThemeAssets', 'failed', `Theme asset deployment error: ${err.message}`);
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

          try {
            const productRes = await fetch(`${apiBase}/products.json`, {
              method: 'POST',
              headers,
              body: JSON.stringify({ product: transformed }),
            });

            if (productRes.ok) {
              totalProductsSynced++;
              if (i % 5 === 0 || i === products.length - 1) {
                addLog('Products', 'in_progress', `Đã đẩy ${totalProductsSynced}/${products.length} sản phẩm: "${transformed.title}"`);
              }
            } else {
              const errData = await productRes.json();
              this.logger.warn(`Failed to push product ${rawP.title}: ${JSON.stringify(errData)}`);
            }
          } catch (e) {
            this.logger.warn(`Push product error: ${e.message}`);
          }
          await this.delay(500); // 2 req/s safe rate limit
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
