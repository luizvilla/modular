// @ts-check
const { defineConfig } = require('playwright');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: 0,
  reporter: [['list']],
});
