"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.filterOffersForAdAction = filterOffersForAdAction;
/**
 * 过滤出适合当前广告动作的候选产品。
 */
function filterOffersForAdAction(offers, actionType) {
    return offers.filter((offer) => {
        if (actionType === '暂停')
            return offer.pStatus === '开启' || offer.status === 1;
        if (actionType === '开启')
            return !(offer.pStatus === '开启' || offer.status === 1);
        if (actionType === '下架')
            return offer.pStatus !== '下架' && offer.status !== 3;
        return true;
    });
}
