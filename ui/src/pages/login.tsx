import { zodResolver } from '@hookform/resolvers/zod';
import { loginInputSchema, type LoginInput, type UserSafe } from '@livechat/shared';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { AxiosError } from 'axios';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';

import { getApi } from '../services/api.js';
import { useAuthStore } from '../store/auth.js';

interface LoginResponse {
  success: boolean;
  data: { user: UserSafe; accessToken: string; refreshToken: string };
}

interface LocationState {
  from?: string;
}

/**
 * Sign-in page — email + password, Zod-validated, posts to /auth/login.
 * @returns The login page element.
 */
export function LoginPage(): React.JSX.Element {
  const { t } = useTranslation();
  const setSession = useAuthStore((s) => s.setSession);
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as LocationState | null)?.from ?? '/';
  const [apiError, setApiError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginInputSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setApiError(null);
    try {
      const res = await getApi().post<LoginResponse>('/auth/login', values);
      setSession(res.data.data);
      await navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 401) {
        setApiError(t('auth.errors.invalidCredentials'));
      } else if (err instanceof AxiosError && err.response?.status === 403) {
        setApiError(t('auth.errors.locked'));
      } else {
        setApiError(t('app.error'));
      }
    }
  });

  return (
    <Container component="main" maxWidth="xs" sx={{ mt: 8 }}>
      <Stack spacing={3}>
        <Typography component="h1" variant="h4">
          {t('auth.login.heading')}
        </Typography>
        <Box
          component="form"
          noValidate
          onSubmit={(e) => {
            void onSubmit(e);
          }}
        >
          <Stack spacing={2}>
            {apiError !== null && (
              <Alert severity="error" role="alert">
                {apiError}
              </Alert>
            )}
            <TextField
              {...register('email')}
              label={t('auth.login.email')}
              type="email"
              autoComplete="username"
              required
              fullWidth
              error={errors.email !== undefined}
              helperText={errors.email?.message}
              slotProps={{ input: { 'aria-invalid': errors.email !== undefined } }}
            />
            <TextField
              {...register('password')}
              label={t('auth.login.password')}
              type="password"
              autoComplete="current-password"
              required
              fullWidth
              error={errors.password !== undefined}
              helperText={errors.password?.message}
              slotProps={{ input: { 'aria-invalid': errors.password !== undefined } }}
            />
            <Button type="submit" variant="contained" disabled={isSubmitting} size="large">
              {isSubmitting ? t('auth.login.submitting') : t('auth.login.submit')}
            </Button>
            <Link component={RouterLink} to="/forgot-password">
              {t('auth.login.forgot')}
            </Link>
          </Stack>
        </Box>
      </Stack>
    </Container>
  );
}

export default LoginPage;
