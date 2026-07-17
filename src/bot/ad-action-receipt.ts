export type AdActionReceiptType = '暂停' | '开启' | '下架';
export type ManagerNameById = Record<string, string>;

function extractOfferCode(offer: any): string {
  const directCode = offer?.bianHao || offer?.productNo || offer?.offerNo || offer?.code;
  if (directCode !== undefined && directCode !== null && String(directCode).trim()) {
    return String(directCode).trim();
  }

  const productText = String(offer?.product || offer?.productName || '').trim();
  const ggMatch = productText.match(/^(.*?)-GG-(.+)$/i);
  if (ggMatch?.[2]?.trim()) {
    return ggMatch[2].trim();
  }

  if (offer?.id !== undefined && offer?.id !== null) {
    return String(offer.id).trim();
  }

  return '未知';
}

function extractGgCode(offer: any): string {
  const directCode = offer?.ggCode || offer?.ggcode || offer?.GGCode;
  if (directCode !== undefined && directCode !== null && String(directCode).trim()) {
    return String(directCode).trim();
  }

  const productText = String(offer?.product || offer?.productName || '').trim();
  const ggMatch = productText.match(/^(.*?)-GG-(.+)$/i);
  if (ggMatch?.[1]?.trim()) {
    return ggMatch[1].trim();
  }

  return '未知';
}

function pickFirstNonEmpty(offer: any, keys: string[]): string {
  for (const key of keys) {
    const value = offer?.[key];
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return '';
}

function extractOperator(offer: any, managerNameById: ManagerNameById): string {
  const gManagers = Array.isArray(offer?.gManagers) ? offer.gManagers : [];
  const mappedNames = gManagers
    .map((id: unknown) => managerNameById[String(id)]?.trim())
    .filter((name: string | undefined): name is string => Boolean(name));

  if (mappedNames.length > 0) {
    return mappedNames.join('/');
  }

  const left = pickFirstNonEmpty(offer, [
    'managerG',
    'managerName',
    'optimizerName',
    'optimizer',
    'operatorName',
    'mediaBuyerName',
    'buyerName',
    'touShouName',
    'nameA',
  ]);
  const right = pickFirstNonEmpty(offer, [
    'managerB',
    'managerBName',
    'optimizerBName',
    'optimizer2Name',
    'operatorBName',
    'mediaBuyerBName',
    'buyerBName',
    'touShouBName',
    'nameB',
  ]);

  if (left && right) return `${left}/${right}`;
  if (left) return left;
  if (right) return right;
  return '未知';
}

export function buildAdActionSuccessReceipt(
  actionType: AdActionReceiptType,
  storeName: string,
  offers: any[],
  managerNameById: ManagerNameById = {}
): string {
  const lines = [`✅ 已${actionType}广告（本次成功 ${offers.length} 个）`, '', `商户：${storeName || '未知商户'}`];

  offers.forEach((offer, index) => {
    lines.push('');
    lines.push(`${index + 1}) 编号：${extractOfferCode(offer)}`);
    lines.push(`   GGCode：${extractGgCode(offer)}`);
    lines.push(`   投手：${extractOperator(offer, managerNameById)}`);
  });

  return lines.join('\n');
}
