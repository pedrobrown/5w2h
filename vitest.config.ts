import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [cloudflareTest(async () => ({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: {
      bindings: {
        TEST_MIGRATIONS: await readD1Migrations('./migrations'),
        YNAB_PAT: 'test-only-token',
        ACCESS_ISSUER: 'https://test.cloudflareaccess.com',
        ACCESS_AUD: 'test-audience',
      },
    },
  }))],
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    clearMocks: true,
    restoreMocks: true,
  },
})
