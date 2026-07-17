import assert from 'node:assert/strict';
import { buildAdActionSuccessReceipt } from './ad-action-receipt';

function testBuildPauseReceiptWithOfferDetails() {
  const text = buildAdActionSuccessReceipt('暂停', '600113-XX', [
    {
      bianHao: '6001-apk23',
      product: 'miffna-GG-6001-apk23',
      managerName: '淇林',
      managerBName: '郑一',
    },
    {
      bianHao: '6001-apk22',
      product: 'u3qfie-GG-6001-apk22',
      managerName: 'henry',
      managerBName: '震剑',
    },
  ]);

  assert.equal(
    text,
    [
      '✅ 已暂停广告（本次成功 2 个）',
      '',
      '商户：600113-XX',
      '',
      '1) 编号：6001-apk23',
      '   GGCode：miffna',
      '   投手：淇林/郑一',
      '',
      '2) 编号：6001-apk22',
      '   GGCode：u3qfie',
      '   投手：henry/震剑',
    ].join('\n')
  );
}

function testBuildPauseReceiptFallsBackToUnknownValues() {
  const text = buildAdActionSuccessReceipt('暂停', '未知商户', [
    {
      id: 123,
      product: 'plain-product-name',
    },
  ]);

  assert.equal(
    text,
    [
      '✅ 已暂停广告（本次成功 1 个）',
      '',
      '商户：未知商户',
      '',
      '1) 编号：123',
      '   GGCode：未知',
      '   投手：未知',
    ].join('\n')
  );
}

function testBuildPauseReceiptUsesRealQlOfferFields() {
  const text = buildAdActionSuccessReceipt('暂停', '验收商户', [
    {
      bianHao: '3673 - HH98 game',
      ggCode: 'ei6zib',
      managerG: '淇林',
      managerB: '郑一',
    },
  ]);

  assert.equal(
    text,
    [
      '✅ 已暂停广告（本次成功 1 个）',
      '',
      '商户：验收商户',
      '',
      '1) 编号：3673 - HH98 game',
      '   GGCode：ei6zib',
      '   投手：淇林/郑一',
    ].join('\n')
  );
}

function testBuildPauseReceiptPrefersGManagersIdMapping() {
  const text = buildAdActionSuccessReceipt(
    '暂停',
    '映射商户',
    [
      {
        bianHao: '6001-apk23',
        ggCode: 'miffna',
        gManagers: [10, 664],
        managerG: '旧值A',
        managerB: '旧值B',
      },
    ],
    {
      10: '淇林',
      664: '郑一',
    }
  );

  assert.equal(
    text,
    [
      '✅ 已暂停广告（本次成功 1 个）',
      '',
      '商户：映射商户',
      '',
      '1) 编号：6001-apk23',
      '   GGCode：miffna',
      '   投手：淇林/郑一',
    ].join('\n')
  );
}

function run() {
  testBuildPauseReceiptWithOfferDetails();
  testBuildPauseReceiptFallsBackToUnknownValues();
  testBuildPauseReceiptUsesRealQlOfferFields();
  testBuildPauseReceiptPrefersGManagersIdMapping();
  console.log('ad-action-receipt tests passed');
}

run();
