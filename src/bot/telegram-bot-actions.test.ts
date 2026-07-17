import assert from 'node:assert/strict';
import { filterOffersForAdAction } from './telegram-bot-actions';

function testFilterOffersForStartActionKeepsNonEnabledOffers() {
  const offers = [
    { id: 1, pStatus: '开启', status: 1 },
    { id: 2, pStatus: '暂停', status: 2 },
    { id: 3, pStatus: '下架', status: 3 },
    { id: 4, pStatus: undefined, status: 2 },
  ];

  const selectedIds = filterOffersForAdAction(offers, '开启').map((offer: any) => offer.id);
  assert.deepEqual(selectedIds, [2, 3, 4]);
}

function testFilterOffersForPauseActionKeepsEnabledOffers() {
  const offers = [
    { id: 1, pStatus: '开启', status: 1 },
    { id: 2, pStatus: '暂停', status: 2 },
    { id: 3, pStatus: '下架', status: 3 },
  ];

  const selectedIds = filterOffersForAdAction(offers, '暂停').map((offer: any) => offer.id);
  assert.deepEqual(selectedIds, [1]);
}

function testFilterOffersForOffActionExcludesOffOffers() {
  const offers = [
    { id: 1, pStatus: '开启', status: 1 },
    { id: 2, pStatus: '暂停', status: 2 },
    { id: 3, pStatus: '下架', status: 3 },
  ];

  const selectedIds = filterOffersForAdAction(offers, '下架').map((offer: any) => offer.id);
  assert.deepEqual(selectedIds, [1, 2]);
}

function run() {
  testFilterOffersForStartActionKeepsNonEnabledOffers();
  testFilterOffersForPauseActionKeepsEnabledOffers();
  testFilterOffersForOffActionExcludesOffOffers();
  console.log('telegram-bot-actions tests passed');
}

run();
