import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { announceLiveMessage } from '../../services/live-region-bus.js';

interface EmbedSnippetProps {
  /** Tenant slug used as `data-tenant-key` on the script tag. */
  tenantSlug: string;
  /** Origin the widget script is served from (defaults to the current origin). */
  widgetOrigin?: string;
}

/**
 * Renders the copy-pasteable `<script>` tag a client drops into their page
 * to load the widget for their tenant.
 * @param props - Tenant slug + optional widget origin.
 * @returns The snippet + copy button.
 */
export function EmbedSnippet(props: EmbedSnippetProps): React.JSX.Element {
  const { t } = useTranslation();
  const origin = props.widgetOrigin ?? window.location.origin.replace(':5174', ':5175');
  const snippet = `<script src="${origin}/widget.js" data-tenant-key="${props.tenantSlug}" defer></script>`;
  const [copied, setCopied] = useState(false);

  const onCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      announceLiveMessage('Snippet copied to clipboard');
      window.setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      announceLiveMessage('Copy failed — please select the snippet manually');
    }
  };

  return (
    <Box>
      <Typography component="p" color="text.secondary" sx={{ mb: 1 }}>
        {t('admin.tenants.embedSnippetHelp')}
      </Typography>
      <Box
        component="pre"
        sx={{
          p: 1,
          bgcolor: 'action.hover',
          borderRadius: 1,
          overflowX: 'auto',
          fontSize: '0.8125rem',
          m: 0,
        }}
      >
        <code>{snippet}</code>
      </Box>
      <Button
        onClick={() => {
          void onCopy();
        }}
        size="small"
        sx={{ mt: 1 }}
      >
        {copied ? 'Copied' : 'Copy to clipboard'}
      </Button>
    </Box>
  );
}
