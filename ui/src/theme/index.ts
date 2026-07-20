import { createTheme, type Theme } from '@mui/material/styles';

/**
 * Build a MUI theme for the support console.
 * @param mode - 'light' or 'dark' (driven by `prefers-color-scheme`).
 * @returns A fully-configured MUI theme.
 */
export function buildTheme(mode: 'light' | 'dark'): Theme {
  return createTheme({
    palette: {
      mode,
      primary: { main: mode === 'dark' ? '#82b1ff' : '#1a56db' },
    },
    typography: {
      fontFamily:
        'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    },
    components: {
      MuiButtonBase: { defaultProps: { disableRipple: false } },
    },
  });
}
