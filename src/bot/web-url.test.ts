import assert from 'node:assert/strict';
import {
  getAdminBaseUrl,
  getPublicWebBaseUrl,
  isPublicWebBaseUrlSecure,
} from './web-url';

function testGetPublicWebBaseUrlPrefersExplicitWebDomainWithoutAppendingAdminPort() {
  assert.equal(
    getPublicWebBaseUrl({
      WEB_DOMAIN: ' `https://ql.runtoads.top` ',
      ADMIN_PORT: '8091',
    } as NodeJS.ProcessEnv),
    'https://ql.runtoads.top'
  );
}

function testGetPublicWebBaseUrlSupportsLegacyWebdomainVariable() {
  assert.equal(
    getPublicWebBaseUrl({
      WEBDOMAIN: ' `https://ql.runtoads.top` ',
      ADMIN_PORT: '8091',
    } as NodeJS.ProcessEnv),
    'https://ql.runtoads.top'
  );
}

function testGetPublicWebBaseUrlPrefersAppSpecificWebdomainOverSharedWebDomain() {
  assert.equal(
    getPublicWebBaseUrl({
      WEBDOMAIN: 'https://ql.runtoads.top',
      WEB_DOMAIN: 'https://www.runtoads.top',
      ADMIN_PORT: '8091',
    } as NodeJS.ProcessEnv),
    'https://ql.runtoads.top'
  );
}

function testGetAdminBaseUrlAppendsAdminPath() {
  assert.equal(
    getAdminBaseUrl({
      WEB_DOMAIN: 'https://ql.runtoads.top',
      ADMIN_PORT: '8091',
    } as NodeJS.ProcessEnv),
    'https://ql.runtoads.top/admin/'
  );
}

function testSecureDetectionUsesResolvedPublicBaseUrl() {
  assert.equal(
    isPublicWebBaseUrlSecure({
      WEBDOMAIN: 'https://ql.runtoads.top',
      ADMIN_PORT: '8091',
    } as NodeJS.ProcessEnv),
    true
  );
}

function run() {
  testGetPublicWebBaseUrlPrefersExplicitWebDomainWithoutAppendingAdminPort();
  testGetPublicWebBaseUrlSupportsLegacyWebdomainVariable();
  testGetPublicWebBaseUrlPrefersAppSpecificWebdomainOverSharedWebDomain();
  testGetAdminBaseUrlAppendsAdminPath();
  testSecureDetectionUsesResolvedPublicBaseUrl();
  console.log('web-url tests passed');
}

run();
