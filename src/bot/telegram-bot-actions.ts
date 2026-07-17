/**
 * 广告动作筛选工具。
 */
export type AdActionType = '暂停' | '开启' | '下架';

/**
 * 过滤出适合当前广告动作的候选产品。
 */
export function filterOffersForAdAction(offers: any[], actionType: AdActionType) {
  return offers.filter((offer) => {
    if (actionType === '暂停') return offer.pStatus === '开启' || offer.status === 1;
    if (actionType === '开启') return !(offer.pStatus === '开启' || offer.status === 1);
    if (actionType === '下架') return offer.pStatus !== '下架' && offer.status !== 3;
    return true;
  });
}
