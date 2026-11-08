import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 20s (vitest's default is 5s). Nearly every test here is a shell
    // integration test: it builds a fixture git repo and runs a gate script or
    // git hook in a subprocess. Under check:all, the pre-push gate, the machine
    // is busy and those cases ran 5-7s and failed on the default, which blocked
    // the push. Run alone they pass well inside it. The few that do more work
    // keep their own larger per-test timeouts.
    testTimeout: 20_000,
  },
});
