import assert from 'node:assert/strict';
import {
  detectOldCodeFromTemplate,
  replaceOfferCodesByTemplate,
} from './ql-writer';

function testDetectOldCodeFromTemplateUsesPrefixAndDigitLength() {
  const baseOffer = {
    bianHao: 'APK58-【-3】QL',
    product: 'APK58-【-3】QL',
    thirdName: '渠道 APK58-【-3】QL',
    adName: '广告 APK58-【-3】QL',
  };

  const oldCode = detectOldCodeFromTemplate(baseOffer, 'APK60');

  assert.equal(oldCode, 'APK58');
}

function testReplaceOfferCodesByTemplateKeepsSuffixDescription() {
  const baseOffer = {
    bianHao: 'APK58-【-3】QL',
    product: 'APK58-【-3】QL',
    thirdName: '渠道 APK58-【-3】QL',
    adName: '广告 APK58-【-3】QL',
  };

  const updated = replaceOfferCodesByTemplate(baseOffer, 'APK60');

  assert.equal(updated.bianHao, 'APK60-【-3】QL');
  assert.equal(updated.product, 'APK60-【-3】QL');
  assert.equal(updated.thirdName, '渠道 APK60-【-3】QL');
  assert.equal(updated.adName, '广告 APK60-【-3】QL');
}

function testDetectOldCodeFromTemplateKeepsDigitLength() {
  const baseOffer = {
    bianHao: 'APK058-测试',
    product: 'APK058-测试',
  };

  const oldCode = detectOldCodeFromTemplate(baseOffer, 'APK060');

  assert.equal(oldCode, 'APK058');
}

function testDetectOldCodeFromTemplateFallsBackToOtherFields() {
  const baseOffer = {
    bianHao: '无编号母本',
    product: '产品 APK58-【-3】QL',
    thirdName: '渠道 APK58-【-3】QL',
    adName: '广告 APK58-【-3】QL',
  };

  const oldCode = detectOldCodeFromTemplate(baseOffer, 'APK60');
  const updated = replaceOfferCodesByTemplate(baseOffer, 'APK60');

  assert.equal(oldCode, 'APK58');
  assert.equal(updated.product, '产品 APK60-【-3】QL');
  assert.equal(updated.thirdName, '渠道 APK60-【-3】QL');
  assert.equal(updated.adName, '广告 APK60-【-3】QL');
}

function testDetectOldCodeFromTemplateThrowsOnAmbiguousMatches() {
  const baseOffer = {
    bianHao: '产品模板',
    product: 'APK58 备用 APK68',
    thirdName: '渠道 APK58',
    adName: '广告 APK68',
  };

  assert.throws(
    () => detectOldCodeFromTemplate(baseOffer, 'APK60'),
    /多个旧编号候选/
  );
}

function testDetectOldCodeFromTemplateSupportsChinesePrefixCodes() {
  const baseOffer = {
    bianHao: '包25-【-3】GG',
    product: '包25-【-3】GG',
    thirdName: '渠道 包25-【-3】GG',
    adName: '广告 包25-【-3】GG',
  };

  const oldCode = detectOldCodeFromTemplate(baseOffer, '包27');
  const updated = replaceOfferCodesByTemplate(baseOffer, '包27');

  assert.equal(oldCode, '包25');
  assert.equal(updated.bianHao, '包27-【-3】GG');
  assert.equal(updated.product, '包27-【-3】GG');
  assert.equal(updated.thirdName, '渠道 包27-【-3】GG');
  assert.equal(updated.adName, '广告 包27-【-3】GG');
}

function testDetectOldCodeFromTemplateSupportsNumericOnlyCodes() {
  const baseOffer = {
    bianHao: '025-主包',
    product: '025-主包',
    thirdName: '渠道 025-主包',
    adName: '广告 025-主包',
  };

  const oldCode = detectOldCodeFromTemplate(baseOffer, '027');
  const updated = replaceOfferCodesByTemplate(baseOffer, '027');

  assert.equal(oldCode, '025');
  assert.equal(updated.bianHao, '027-主包');
  assert.equal(updated.product, '027-主包');
  assert.equal(updated.thirdName, '渠道 027-主包');
  assert.equal(updated.adName, '广告 027-主包');
}

function testDetectOldCodeFromTemplateSupportsAlphaNumericPrefixCodes() {
  const baseOffer = {
    bianHao: '38R029-主包',
    product: '38R029-主包',
    thirdName: '渠道 38R029-主包',
    adName: '广告 38R029-主包',
  };

  const oldCode = detectOldCodeFromTemplate(baseOffer, '38R080');
  const updated = replaceOfferCodesByTemplate(baseOffer, '38R080');

  assert.equal(oldCode, '38R029');
  assert.equal(updated.bianHao, '38R080-主包');
  assert.equal(updated.product, '38R080-主包');
  assert.equal(updated.thirdName, '渠道 38R080-主包');
  assert.equal(updated.adName, '广告 38R080-主包');
}

function testDetectOldCodeFromTemplateSupportsDigitLengthExpansion() {
  const baseOffer = {
    bianHao: 'APK9-【-3】QL',
    product: 'APK9-【-3】QL',
    thirdName: '渠道 APK9-【-3】QL',
    adName: '广告 APK9-【-3】QL',
  };

  const oldCode = detectOldCodeFromTemplate(baseOffer, 'APK10');
  const updated = replaceOfferCodesByTemplate(baseOffer, 'APK10');

  assert.equal(oldCode, 'APK9');
  assert.equal(updated.bianHao, 'APK10-【-3】QL');
  assert.equal(updated.product, 'APK10-【-3】QL');
  assert.equal(updated.thirdName, '渠道 APK10-【-3】QL');
  assert.equal(updated.adName, '广告 APK10-【-3】QL');
}

function testDetectOldCodeFromTemplateSupportsThreeDigitToFourDigitExpansion() {
  const baseOffer = {
    bianHao: 'APK099-【-3】QL',
    product: 'APK099-【-3】QL',
    thirdName: '渠道 APK099-【-3】QL',
    adName: '广告 APK099-【-3】QL',
  };

  const oldCode = detectOldCodeFromTemplate(baseOffer, 'APK100');
  const updated = replaceOfferCodesByTemplate(baseOffer, 'APK100');

  assert.equal(oldCode, 'APK099');
  assert.equal(updated.bianHao, 'APK100-【-3】QL');
  assert.equal(updated.product, 'APK100-【-3】QL');
  assert.equal(updated.thirdName, '渠道 APK100-【-3】QL');
  assert.equal(updated.adName, '广告 APK100-【-3】QL');
}

function run() {
  testDetectOldCodeFromTemplateUsesPrefixAndDigitLength();
  testReplaceOfferCodesByTemplateKeepsSuffixDescription();
  testDetectOldCodeFromTemplateKeepsDigitLength();
  testDetectOldCodeFromTemplateFallsBackToOtherFields();
  testDetectOldCodeFromTemplateThrowsOnAmbiguousMatches();
  testDetectOldCodeFromTemplateSupportsChinesePrefixCodes();
  testDetectOldCodeFromTemplateSupportsNumericOnlyCodes();
  testDetectOldCodeFromTemplateSupportsAlphaNumericPrefixCodes();
  testDetectOldCodeFromTemplateSupportsDigitLengthExpansion();
  testDetectOldCodeFromTemplateSupportsThreeDigitToFourDigitExpansion();
  console.log('ql-writer tests passed');
}

run();
