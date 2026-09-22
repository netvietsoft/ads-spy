import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  StorefrontBlueprint,
  ThemeDeployOptions,
  DeployResult,
  DeployStepLog,
} from './theme-cloner.types';

@Injectable()
export class ThemeDeployerService {
  private readonly logger = new Logger(ThemeDeployerService.name);

  constructor(private readonly prisma: PrismaService) {}

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

    addLog('Summary', 'success', `Triển khai hoàn tất! Đã tạo ${createdPages.length} trang, ${createdPolicies.length} chính sách, ${createdCollections.length} danh mục.`);

    return {
      success: true,
      targetDomain,
      logs,
      createdPages,
      createdPolicies,
      createdCollections,
      deployedAssets,
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
