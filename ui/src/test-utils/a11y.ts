import { runAccessibilityTests } from '@afixt/a11y-assert';

interface Violation {
  rule: string;
  message: string;
  severity?: string;
}

/**
 * Run the @afixt/a11y-assert suite against a rendered fragment and throw if
 * any violations are reported. Intended for Playwright tests where real
 * browser CSS is available — jsdom component tests produce false positives
 * because they can't compute layout (see phase-4 notes).
 * @param container - The element to scan (typically `render().container`).
 */
export async function expectNoA11yViolations(container: Element): Promise<void> {
  const raw = await runAccessibilityTests(container);
  const violations: Violation[] = Array.isArray(raw) ? (raw as unknown as Violation[]) : [];
  if (violations.length > 0) {
    const summary = violations
      .map((v) => `${v.rule}: ${v.message} [${v.severity ?? 'unknown'}]`)
      .join('\n');
    throw new Error(`A11y violations:\n${summary}`);
  }
}
