import { Config, ParsedData, Customer } from '../types/config.types';

const GLOBAL_EXCLUDES = ['下架', '暂停'];

export const processMessage = (text: string, config: Config): ParsedData[] => {
  const blocks = text.split(/\n\s*\n/);
  const results: ParsedData[] = [];

  for (const block of blocks) {
    const b = block.trim();
    if (!b) continue;

    // Trigger conditions
    const hasNameAndLink = b.includes('名称') && b.includes('链接');
    const hasLinkAndNaming = b.includes('链接') && b.includes('命名');
    const hasGodAndUp = b.includes('神包') && b.includes('上');

    let triggered = false;
    if (hasGodAndUp) triggered = true;
    if (hasNameAndLink || hasLinkAndNaming) {
      // Check if contains global excludes
      const hasGlobalExclude = GLOBAL_EXCLUDES.some(ex => b.includes(ex));
      if (!hasGlobalExclude) triggered = true;
    }

    if (!triggered) continue;

    // Sort customers by priority (asc)
    const sortedCustomers = [...config.customers].sort((a, b) => a.priority - b.priority);

    let matchedCustomer: Customer | null = null;
    for (const customer of sortedCustomers) {
      const matchKws = customer.match_keywords || [];
      const excludeKws = customer.exclude_keywords || [];

      const isMatch = matchKws.some(kw => b.includes(kw));
      const isExclude = excludeKws.some(kw => b.includes(kw));

      if (isMatch && !isExclude) {
        matchedCustomer = customer;
        break;
      }
    }

    if (!matchedCustomer) continue;

    // Extract fields
    const data: Record<string, string> = {};
    for (const [field, rule] of Object.entries(matchedCustomer.rules)) {
      let extractedValue = '';
      if (rule.type === 'regex' && rule.pattern) {
        const regex = new RegExp(rule.pattern);
        const match = b.match(regex);
        if (match) {
          extractedValue = match[1] || match[0];
          if (rule.transform) {
            if (rule.transform === 'toUpperCase') {
              extractedValue = extractedValue.toUpperCase();
            } else if (rule.transform.startsWith('replace:')) {
              const parts = rule.transform.split(':')[1].split('=>');
              if (parts.length === 2) {
                extractedValue = extractedValue.replace(parts[0], parts[1]);
              }
            } else if (rule.transform.includes('$1')) {
              extractedValue = rule.transform.replace('$1', extractedValue);
            }
          }
        }
      } else if (rule.type === 'keyword_line' && rule.keyword) {
        const lines = b.split('\n');
        const line = lines.find(l => l.includes(rule.keyword!));
        if (line) {
          extractedValue = line;
          if (rule.strip_chars) {
            const chars = rule.strip_chars.split('');
            for (const c of chars) {
              extractedValue = extractedValue.replace(new RegExp(`\\${c}`, 'g'), '');
            }
            extractedValue = extractedValue.replace(rule.keyword, '').trim();
          }
        }
      } else if (rule.type === 'url') {
        const urlRegex = /(https?:\/\/[^\s]+)/;
        const match = b.match(urlRegex);
        if (match) extractedValue = match[1];
      } else if (rule.type === 'constant' && rule.value) {
        extractedValue = rule.value;
      }
      data[field] = extractedValue;
    }

    results.push({
      customerName: matchedCustomer.name,
      data
    });
  }

  return results;
};
