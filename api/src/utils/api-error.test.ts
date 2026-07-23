import { describe, expect, it } from 'vitest';

import { ApiError } from './api-error.js';

describe('ApiError', () => {
  it('sets status, message, name, and details from the constructor', () => {
    const err = new ApiError(418, "I'm a teapot", { hint: 'brew' });
    expect(err.status).toBe(418);
    expect(err.message).toBe("I'm a teapot");
    expect(err.name).toBe('ApiError');
    expect(err.details).toEqual({ hint: 'brew' });
    expect(err).toBeInstanceOf(Error);
  });

  it('leaves details undefined when not supplied', () => {
    const err = new ApiError(500, 'boom');
    expect(err.details).toBeUndefined();
  });

  it('badRequest defaults status 400 and accepts details', () => {
    const err = ApiError.badRequest('bad input', { field: 'email' });
    expect(err.status).toBe(400);
    expect(err.message).toBe('bad input');
    expect(err.details).toEqual({ field: 'email' });
  });

  it('unauthorized defaults its message', () => {
    const err = ApiError.unauthorized();
    expect(err.status).toBe(401);
    expect(err.message).toBe('Authentication required');
  });

  it('unauthorized accepts a custom message', () => {
    const err = ApiError.unauthorized('Token expired');
    expect(err.status).toBe(401);
    expect(err.message).toBe('Token expired');
  });

  it('forbidden defaults its message', () => {
    const err = ApiError.forbidden();
    expect(err.status).toBe(403);
    expect(err.message).toBe('Insufficient permissions');
  });

  it('forbidden accepts a custom message', () => {
    const err = ApiError.forbidden('Access denied to this tenant');
    expect(err.status).toBe(403);
    expect(err.message).toBe('Access denied to this tenant');
  });

  it('notFound defaults its message', () => {
    const err = ApiError.notFound();
    expect(err.status).toBe(404);
    expect(err.message).toBe('Not found');
  });

  it('notFound accepts a custom message', () => {
    const err = ApiError.notFound('Route not found: GET /nope');
    expect(err.status).toBe(404);
    expect(err.message).toBe('Route not found: GET /nope');
  });

  it('conflict requires and sets a message', () => {
    const err = ApiError.conflict('Email already in use');
    expect(err.status).toBe(409);
    expect(err.message).toBe('Email already in use');
  });

  it('tooManyRequests defaults its message', () => {
    const err = ApiError.tooManyRequests();
    expect(err.status).toBe(429);
    expect(err.message).toBe('Too many requests');
  });

  it('tooManyRequests accepts a custom message', () => {
    const err = ApiError.tooManyRequests('Slow down');
    expect(err.status).toBe(429);
    expect(err.message).toBe('Slow down');
  });
});
