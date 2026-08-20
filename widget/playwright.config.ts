import { devices } from '@playwright/test';

import {
  defineGeneratedSpecConfig,
  DEV_STACK_PORTS,
} from '../e2e/support/generated-spec-config.js';

export default defineGeneratedSpecConfig({
  port: DEV_STACK_PORTS.widget,
  // These standalone widget specs have no agent socket, so seed one available
  // staff placeholder — otherwise a visitor-initiated chat lands in no_support
  // and the customer-initiates happy path can't reach the active state.
  apiEnvExtra: { SEED_STAFF_AVAILABLE: '1' },
  projects: [
    {
      // Only the self-contained specs run standalone. `widget-close` and
      // `widget-actively-chatting` declare preconditions (an open panel, an
      // active chat) that a single generated spec cannot establish — those
      // transitions are exercised in the e2e journey suite instead.
      name: 'chromium',
      testMatch: /generated\/widget-(initial|customer-initiates)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
