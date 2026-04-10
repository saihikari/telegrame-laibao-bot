import { Config, ParsedData, Customer } from '../types/config.types';

const GLOBAL_EXCLUDES = ['下架', '暂停'];

export const processMessage = (text: string, config: Config): ParsedData[] => {
  console.log('[RuleEngine] Received message for processing:', JSON.stringify(text));
  const blocks = text.split(/\n\s*\n/);
  console.log(`[RuleEngine] Split message into ${blocks.length} blocks.`);
  const results: ParsedData[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const b = block.trim();
    if (!b) continue;

    console.log(`[RuleEngine] Analyzing block ${i + 1}:`, JSON.stringify(b));

    // Trigger conditions
    const hasNameAndLink = b.includes('名称') && b.includes('链接');
    const hasLinkAndNaming = b.includes('链接') && b.includes('命名');
    const hasGodAndUp = b.includes('神包') && b.includes('上');
    // 新增：只要包含 http 链接，或者包含马甲包等明显特征，也算触发
    const hasUrl = /https?:\/\//.test(b);

    console.log(`[RuleEngine] Block ${i + 1} trigger conditions: hasNameAndLink=${hasNameAndLink}, hasLinkAndNaming=${hasLinkAndNaming}, hasGodAndUp=${hasGodAndUp}, hasUrl=${hasUrl}`);

    let triggered = false;
    if (hasGodAndUp || hasUrl) triggered = true;
    if (hasNameAndLink || hasLinkAndNaming) {
      // Check if contains global excludes
      const hasGlobalExclude = GLOBAL_EXCLUDES.some(ex => b.includes(ex));
      console.log(`[RuleEngine] Block ${i + 1} global exclude check: hasGlobalExclude=${hasGlobalExclude}`);
      if (!hasGlobalExclude) triggered = true;
    }

    if (!triggered) {
      console.log(`[RuleEngine] Block ${i + 1} did not meet any trigger conditions. Skipping.`);
      continue;
    }

    console.log(`[RuleEngine] Block ${i + 1} triggered! Checking customer matches...`);

    // Sort customers by priority (asc)
    const sortedCustomers = [...config.customers].sort((a, b) => a.priority - b.priority);

    let matchedCustomer: Customer | null = null;
    for (const customer of sortedCustomers) {
      const matchKws = customer.match_keywords || [];
      const excludeKws = customer.exclude_keywords || [];

      const isMatch = matchKws.some(kw => b.includes(kw));
      const isExclude = excludeKws.some(kw => b.includes(kw));

      console.log(`[RuleEngine] Checking customer '${customer.name}': isMatch=${isMatch}, isExclude=${isExclude}`);

      if (isMatch && !isExclude) {
        matchedCustomer = customer;
        console.log(`[RuleEngine] Block ${i + 1} matched customer: ${customer.name}`);
        break;
      }
    }

    if (!matchedCustomer) {
      console.log(`[RuleEngine] Block ${i + 1} did not match any customer. Skipping.`);
      continue;
    }

    // Extract fields
    console.log(`[RuleEngine] Extracting fields for customer ${matchedCustomer.name}...`);
    const data: Record<string, string> = {};
    for (const [field, rule] of Object.entries(matchedCustomer.rules)) {
      let extractedValue = '';
      if (rule.type === 'regex' && rule.pattern) {
        // 使用 m 修饰符以支持多行匹配
        const regex = new RegExp(rule.pattern, 'm');
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
      console.log(`[RuleEngine] Extracted field '${field}': ${extractedValue}`);
    }

    results.push({
      customerName: matchedCustomer.name,
      data
    });
  }

  console.log(`[RuleEngine] Finished processing message. Total results: ${results.length}`);
  return results;
};
