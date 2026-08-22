import { devices } from '@playwright/test';

import {
  defineGeneratedSpecConfig,
  DEV_STACK_PORTS,
} from '../e2e/support/generated-spec-config.js';

export default defineGeneratedSpecConfig({
  port: DEV_STACK_PORTS.console,
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      // Admin specs assume a super_admin is authenticated. `admin-invite-user`
      // is excluded: the DSL emits selectOption() for its role dropdown, which
      // only drives a native <select>; MUI renders a listbox combobox. Upstream
      // in @afixt/usecase-runner, tracked in #6.
      // `admin-edit-tenant-settings`, `admin-edit-user`, `admin-rotate-embed-
      // secret` and `admin-revoke-invitation` are excluded: their per-row
      // "Edit"/"Revoke" targets are ambiguous against a multi-row list (or
      // need a pending invitation / an expanded row a standalone spec can't
      // establish) — the journey suite covers those transitions.
      name: 'admin',
      testMatch:
        /generated\/admin-(create-tenant|view-tenants|view-users|view-invitations)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/admin.json' },
      dependencies: ['setup'],
    },
    {
      name: 'support-dashboard',
      testMatch: /generated\/support-view-dashboard\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/staff.json' },
      dependencies: ['setup'],
    },
    {
      // Its own session — logout blacklists the token, which would otherwise
      // break the dashboard spec that shares it.
      name: 'support-logout',
      testMatch: /generated\/support-logout\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/staff-logout.json' },
      dependencies: ['setup'],
    },
    {
      // Only toggles the client-side alert-sound preference, so it can share
      // the dashboard session without affecting other specs.
      name: 'support-preferences',
      testMatch: /generated\/support-toggle-alert-sound\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/staff.json' },
      dependencies: ['setup'],
    },
    {
      // Sets the operator's own explicit availability. `check()` is idempotent
      // so it is safe to share the dashboard session regardless of prior state.
      name: 'support-availability',
      testMatch: /generated\/support-set-availability\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], storageState: 'e2e/.auth/staff.json' },
      dependencies: ['setup'],
    },
    {
      name: 'support-anon',
      testMatch: /generated\/support-login.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
