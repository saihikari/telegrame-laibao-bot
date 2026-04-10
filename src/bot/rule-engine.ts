import { Config, ParsedData, Customer } from '../types/config.types';

const GLOBAL_EXCLUDES = ['下架', '暂停'];

export const processMessage = (text: string, config: Config): ParsedData[] => {
  console.log('[RuleEngine] Received message for processing:', JSON.stringify(text));
  
  // 先把文本里可能出现的不规范的换行清理一下（如果有连续多个换行，保留两个，或者用更宽松的策略）
  // 但为了兼容 "神包上线" 这种单独一行的头，我们不能死板地用 \n\n 切分，
  // 最好是把全局的 "神包上线" 这种标志先拿出来，或者不管它，只要某一块里有我们需要的信息就行。
  // 我们改用更宽松的切分：通过包含 URL 的行，向上向下寻找一个完整的“包块”。
  // 但由于原有的逻辑是用 \n\n 切分，如果用户排版不规范（比如包和包之间没有空行），就会切分失败。
  // 我们先尝试用现有的 \n\n 切分，如果切出来的块太少，我们再尝试更智能的分割。
  
  // 改进切分逻辑：兼容一些不规范的空行（比如带有全角空格的空行）
  let blocks = text.split(/\n[ \t\r\f]*\n/);
  
  // 如果所有的东西都被黏在一个 block 里，我们需要智能切分它
  if (blocks.length === 1 && text.match(/https?:\/\//g)?.length && (text.match(/https?:\/\//g)?.length || 0) > 1) {
    console.log('[RuleEngine] Detected multiple URLs in a single block, attempting intelligent split...');
    // 尝试根据常见的“客户包标识”或者“应用名称”前面加空行来强制切分
    // 这里我们可以根据 "S97" 或者 "BA99" 或者 "pak" 这种作为每个包的开头
    // 为了稳妥，我们直接在 "S97包"、"BA99-"、"pak" 前面强制插入双换行
    let newText = text;
    newText = newText.replace(/(\n)(S97包)/g, '$1\n$2');
    newText = newText.replace(/(\n)(BA99-)/g, '$1\n$2');
    newText = newText.replace(/(\n)(pak)/g, '$1\n$2');
    blocks = newText.split(/\n[ \t\r\f]*\n/);
  }
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
    const hasClientTag = b.includes('S97') || b.includes('BA99') || b.includes('pak') || b.includes('VIP') || b.includes('APP0');

    console.log(`[RuleEngine] Block ${i + 1} trigger conditions: hasNameAndLink=${hasNameAndLink}, hasLinkAndNaming=${hasLinkAndNaming}, hasGodAndUp=${hasGodAndUp}, hasUrl=${hasUrl}, hasClientTag=${hasClientTag}`);

    let triggered = false;
    if (hasGodAndUp || hasUrl || hasClientTag) triggered = true;
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

      const isMatch = matchKws.every(kw => b.includes(kw));
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
      
      // 全局清理：移除所有提取出的值中的特殊emoji字符（如🔥、📱、‼️等）
      // 这里使用正则表达式去掉大部分常见的 emoji 和特殊符号
      if (typeof data[field] === 'string') {
        data[field] = data[field].replace(/[\u{1F300}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F1E6}-\u{1F1FF}\u{1F201}-\u{1F251}\u{1F004}\u{1F0CF}\u{1F170}-\u{1F171}\u{1F17E}-\u{1F17F}\u{1F18E}\u{3030}\u{2B50}\u{2B55}\u{2934}-\u{2935}\u{2B05}-\u{2B07}\u{2B1B}-\u{2B1C}\u{3297}\u{3299}\u{303D}\u{00A9}\u{00AE}\u{2122}\u{23F3}\u{24C2}\u{23E9}-\u{23EF}\u{25B6}\u{23F8}-\u{23FA}\u{200D}]/gu, '').trim();
      }
      
      console.log(`[RuleEngine] Extracted field '${field}': ${data[field]}`);
    }

    results.push({
      customerName: matchedCustomer.name,
      data
    });
  }

  console.log(`[RuleEngine] Finished processing message. Total results: ${results.length}`);
  return results;
};
