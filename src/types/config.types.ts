export interface Rule {
  type: 'regex' | 'keyword_line' | 'url' | 'constant';
  pattern?: string;
  transform?: string;
  keyword?: string;
  strip_chars?: string;
  value?: string;
}

export interface Customer {
  name: string;
  match_keywords: string[];
  priority: number;
  exclude_keywords: string[];
  rules: Record<string, Rule>;
}

export interface Config {
  delayMinSeconds?: number;
  delayMaxSeconds?: number;
  customers: Customer[];
}

export interface ParsedData {
  customerName: string;
  data: Record<string, string>;
}
