export type Features = Record<string, boolean>;
export type Quotas = Record<string, number | null>; // null = unlimited

export interface Entitlement {
  access: string; // 'staff' | 'free' | 'free-limited' | 'none' | tier ('basic'|'pro'|'premium'|'comp')
  tier: string | null;
  features: Features;
  quotas: Quotas;
  recordCap: number | null; // null = unlimited
}

export function isStaff(role: string): boolean {
  return role === 'admin' || role === 'manager';
}
