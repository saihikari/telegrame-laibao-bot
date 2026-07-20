const assert = require('node:assert/strict');
const { buildOfferKeyboard } = require('./offer-keyboard.js');

function testBuildOfferKeyboardUsesTwoOfferButtonsPerRow() {
  const offers = [
    { id: 1, product: 'A-GG-APK101' },
    { id: 2, product: 'A-GG-APK102' },
    { id: 3, product: 'A-GG-APK103' },
    { id: 4, product: 'A-GG-APK104' },
    { id: 5, product: 'A-GG-APK105' },
  ];

  const keyboard = buildOfferKeyboard(offers, new Set(), 2);

  assert.equal(keyboard.length, 6);
  assert.deepEqual(
    keyboard.slice(0, 3).map((row) => row.map((button) => button.callback_data)),
    [
      ['adaction_prod:1', 'adaction_prod:2'],
      ['adaction_prod:3', 'adaction_prod:4'],
      ['adaction_prod:5'],
    ]
  );
  assert.deepEqual(keyboard[3].map((button) => button.callback_data), ['adaction_prod:ALL']);
  assert.deepEqual(keyboard[4].map((button) => button.callback_data), ['adaction_confirm']);
  assert.deepEqual(keyboard[5].map((button) => button.callback_data), ['adaction_cancel']);
}

function run() {
  testBuildOfferKeyboardUsesTwoOfferButtonsPerRow();
  console.log('telegram-bot layout tests passed');
}

run();
