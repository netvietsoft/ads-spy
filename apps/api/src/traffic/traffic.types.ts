export interface TrafficData {
  visits: number | null;
  bounce_rate: number;
  time_on_site: number | null;
  pages_per_visit: number | null;
  global_rank: number | null;
  country_rank: number | null;
  month: string;
  year: string;
  hostname: string;
  monthly_visits?: Record<string, number>;
}

export interface TrafficResult {
  traffic: Record<string, TrafficData>;
  whois: Record<string, unknown>;
}
