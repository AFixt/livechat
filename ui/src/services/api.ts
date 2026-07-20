import axios, { type AxiosError, type AxiosInstance } from 'axios';

import { useAuthStore } from '../store/auth.js';

/**
 * API base URL for the livechat backend — proxied by Vite in dev, same-origin
 * or tenant subdomain in prod.
 */
export const API_BASE = '/api/v1';

let client: AxiosInstance | null = null;

/**
 * Lazily build the axios instance so it can pick up the latest access token
 * on every request.
 * @returns The shared axios instance.
 */
export function getApi(): AxiosInstance {
  if (client !== null) return client;
  const instance = axios.create({
    baseURL: API_BASE,
    timeout: 15_000,
    withCredentials: true,
  });
  instance.interceptors.request.use((config) => {
    const token = useAuthStore.getState().accessToken;
    if (token !== null) {
      config.headers.set('Authorization', `Bearer ${token}`);
    }
    return config;
  });
  instance.interceptors.response.use(
    (res) => res,
    (err: AxiosError) => {
      if (err.response?.status === 401) {
        useAuthStore.getState().clear();
      }
      return Promise.reject(err);
    },
  );
  client = instance;
  return instance;
}
