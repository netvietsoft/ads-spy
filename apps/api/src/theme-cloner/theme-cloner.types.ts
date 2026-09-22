export interface ScrapedPage {
  title: string;
  handle: string;
  url: string;
  bodyHtml: string;
}

export interface ScrapedPolicy {
  type: 'refund' | 'privacy' | 'shipping' | 'terms' | 'other';
  title: string;
  url: string;
  bodyHtml: string;
}

export interface ScrapedMenuLink {
  title: string;
  url: string;
  type?: 'collection' | 'page' | 'policy' | 'external';
}

export interface ScrapedCollection {
  title: string;
  handle: string;
  url: string;
  imageUrl?: string;
}

export interface StorefrontBlueprint {
  sourceDomain: string;
  myshopifyDomain?: string;
  themeName: string;
  themeVersion: string;
  title: string;
  announcementBarText?: string;
  logoUrl?: string;
  faviconUrl?: string;
  heroBannerUrl?: string;
  ctaText?: string;
  ctaUrl?: string;
  colors: {
    background: string;
    foreground: string;
    button: string;
    buttonText: string;
    secondaryButton: string;
    secondaryButtonText: string;
    contrast: string;
  };
  typography: {
    headingFont: string;
    bodyFont: string;
  };
  sections: string[];
  collections: ScrapedCollection[];
  pages: ScrapedPage[];
  policies: ScrapedPolicy[];
  headerMenu: ScrapedMenuLink[];
  footerMenu: ScrapedMenuLink[];
  cdnImages: string[];
  analyzedAt: string;
}

export interface ThemeDeployOptions {
  targetStoreId?: string | number;
  shopDomain?: string;
  accessToken?: string;
  deployPages?: boolean;
  deployPolicies?: boolean;
  deployCollections?: boolean;
  deployMenus?: boolean;
  deployThemeAssets?: boolean;
  themeId?: number | string;
  // Combo 1-Click Product sync options
  deployProducts?: boolean;
  priceMultiplier?: number;
  priceAddition?: number;
  priceRounding?: string;
  overrideVendor?: string;
  productLimit?: number;
}

export interface DeployStepLog {
  step: string;
  status: 'pending' | 'in_progress' | 'success' | 'failed' | 'skipped';
  message: string;
  details?: any;
  timestamp: string;
}

export interface DeployResult {
  success: boolean;
  targetDomain: string;
  shopifyAdminUrl?: string;
  logs: DeployStepLog[];
  createdPages: string[];
  createdPolicies: string[];
  createdCollections: string[];
  deployedAssets: string[];
  totalProductsSynced?: number;
  error?: string;
}
