import { Markup } from 'telegraf';
import { InlineKeyboardButton } from 'telegraf/typings/core/types/typegram';

interface Offer {
    id: string;
    name: string;
    // Add other properties of Offer if necessary
}

interface SelectedOffers {
    [key: string]: boolean;
}

/**
 * Builds an inline keyboard for offer selection with a fixed number of columns.
 * @param offers - Array of available offers.
 * @param selectedOffers - Object indicating which offers are currently selected.
 * @param actionPrefix - Prefix for callback data (e.g., 'pause_', 'resume_', 'remove_').
 * @param columns - Number of columns for the offer buttons.
 * @returns Telegraf inline keyboard markup.
 */
export function buildOfferKeyboard(
    offers: Offer[],
    selectedOffers: SelectedOffers,
    actionPrefix: string,
    columns: number = 2 // Fixed to 2 columns as per requirement
) {
    const offerButtons: InlineKeyboardButton[][] = [];
    let currentRow: InlineKeyboardButton[] = [];

    offers.forEach(offer => {
        const isSelected = selectedOffers[offer.id];
        const buttonText = isSelected ? `✅ ${offer.name}` : offer.name;
        currentRow.push(
            Markup.button.callback(buttonText, `${actionPrefix}${offer.id}`)
        );

        if (currentRow.length === columns) {
            offerButtons.push(currentRow);
            currentRow = [];
        }
    });

    if (currentRow.length > 0) {
        offerButtons.push(currentRow);
    }

    const controlButtons = [
        Markup.button.callback('全选', `${actionPrefix}all`),
        Markup.button.callback('确认', `${actionPrefix}confirm`),
        Markup.button.callback('取消', `${actionPrefix}cancel`),
    ];

    offerButtons.push(controlButtons);

    return Markup.inlineKeyboard(offerButtons);
}
