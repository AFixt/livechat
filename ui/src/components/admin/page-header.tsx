import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';

interface PageHeaderProps {
  /** Visible heading text, rendered as an `h2`. */
  heading: string;
  /** Optional primary action rendered opposite the heading. */
  action?: { label: string; onClick: () => void };
}

/**
 * Admin page heading with an optional right-aligned primary action button.
 * @param props - Heading text and optional action descriptor.
 * @returns The header element.
 */
export function PageHeader(props: PageHeaderProps): React.JSX.Element {
  const { heading, action } = props;

  if (action === undefined) {
    return (
      <Typography component="h2" variant="h4">
        {heading}
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <Typography component="h2" variant="h4">
        {heading}
      </Typography>
      <Button variant="contained" onClick={action.onClick}>
        {action.label}
      </Button>
    </Box>
  );
}
