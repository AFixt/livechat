import { afterEach, describe, expect, it } from 'vitest';

import { bcryptCost } from '../../src/models/user.js';

const original = process.env['NODE_ENV'];

describe('bcryptCost (#71)', () => {
  afterEach(() => {
    process.env['NODE_ENV'] = original;
  });

  it('is 12 in production — the cost is lowered for tests only', () => {
    process.env['NODE_ENV'] = 'production';
    expect(bcryptCost()).toBe(12);
  });

  it('is 12 in development — dev is not a test environment', () => {
    process.env['NODE_ENV'] = 'development';
    expect(bcryptCost()).toBe(12);
  });

  it('is lowered to 4 in the test environment', () => {
    process.env['NODE_ENV'] = 'test';
    expect(bcryptCost()).toBe(4);
  });
});
