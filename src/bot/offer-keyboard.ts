import { InlineKeyboardButton } from 'node-telegram-bot-api';

interface Offer {
    id: number;
    name: string;
}

type SelectedOffers = Set<number>;

/**
 * 构建广告操作的内联键盘（每行固定 2 列）
 * @param offers 可选广告列表
 * @param selectedOffers 已选中的广告 id 集合
 * @param actionPrefix 回调前缀（如 'adaction_prod:'）
 * @param columns 每行按钮数，默认 2
 * @returns node-telegram-bot-api 原生 inline_keyboard 二维数组
 */
export function buildOfferKeyboard(
    offers: Offer[],
    selectedOffers: SelectedOffers,
    actionPrefix: string,
    columns: number = 2
): InlineKeyboardButton[][] {
    const rows: InlineKeyboardButton[][] = [];
    let currentRow: InlineKeyboardButton[] = [];

    for (const offer of offers) {
        const isSelected = selectedOffers.has(offer.id);
        const buttonText = isSelected ? `✅ ${offer.name}` : offer.name;
        currentRow.push({
            text: buttonText,
            callback_data: `${actionPrefix}${offer.id}`
        });

        if (currentRow.length === columns) {
            rows.push(currentRow);
            currentRow = [];
        }
    }

    if (currentRow.length > 0) {
        rows.push(currentRow);
    }

    // 控制按钮（全选 / 确认 / 取消），单独成行
    rows.push([
        { text: '全选', callback_data: `${actionPrefix}ALL` },
        { text: '确认', callback_data: 'adaction_confirm' },
        { text: '取消', callback_data: 'adaction_cancel' }
    ]);

    return rows;
}
