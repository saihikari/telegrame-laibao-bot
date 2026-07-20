"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildOfferKeyboard = void 0;
const telegraf_1 = require("telegraf");
/**
 * Builds an inline keyboard for offer selection with a fixed number of columns.
 * @param offers - Array of available offers.
 * @param selectedOffers - Object indicating which offers are currently selected.
 * @param actionPrefix - Prefix for callback data (e.g., 'pause_', 'resume_', 'remove_').
 * @param columns - Number of columns for the offer buttons.
 * @returns Telegraf inline keyboard markup.
 */
function buildOfferKeyboard(offers, selectedOffers, actionPrefix, columns = 2 // Fixed to 2 columns as per requirement
) {
    const offerButtons = [];
    let currentRow = [];
    offers.forEach(offer => {
        const isSelected = selectedOffers[offer.id];
        const buttonText = isSelected ? `✅ ${offer.name}` : offer.name;
        currentRow.push(telegraf_1.Markup.button.callback(buttonText, `${actionPrefix}${offer.id}`));
        if (currentRow.length === columns) {
            offerButtons.push(currentRow);
            currentRow = [];
        }
    });
    if (currentRow.length > 0) {
        offerButtons.push(currentRow);
    }
    const controlButtons = [
        telegraf_1.Markup.button.callback('全选', `${actionPrefix}all`),
        telegraf_1.Markup.button.callback('确认', `${actionPrefix}confirm`),
        telegraf_1.Markup.button.callback('取消', `${actionPrefix}cancel`),
    ];
    offerButtons.push(controlButtons);
    return telegraf_1.Markup.inlineKeyboard(offerButtons);
}
exports.buildOfferKeyboard = buildOfferKeyboard;
//# sourceMappingURL=offer-keyboard.js.map
