import Alert from '@mui/material/Alert';
import Paper from '@mui/material/Paper';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Typography from '@mui/material/Typography';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

/** One column heading in an {@link AdminTable}. */
export interface AdminTableColumn {
  /** Translated header text. */
  label: string;
  /** Set for trailing action columns. */
  align?: 'right';
}

/**
 * The subset of a React Query result {@link AdminTable} needs. Kept
 * structural so callers can pass a `useQuery` result directly.
 */
export interface AdminTableQuery<T> {
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  data: T[] | undefined;
}

interface AdminTableProps<T> {
  /** Accessible name for the table, normally the page heading. */
  label: string;
  columns: readonly AdminTableColumn[];
  query: AdminTableQuery<T>;
  /** Stable React key for each row. */
  rowKey: (item: T) => string;
  /** Renders the `TableRow`(s) for one item. */
  renderRow: (item: T) => React.JSX.Element;
}

/**
 * Shared admin list table — renders loading, error, and empty states around
 * a caller-supplied row renderer so every admin page announces those states
 * identically.
 * @param props - Table label, columns, query result, and row renderer.
 * @returns The table element, or the loading/error placeholder.
 */
export function AdminTable<T>(props: AdminTableProps<T>): React.JSX.Element {
  const { t } = useTranslation();
  const { label, columns, query, rowKey, renderRow } = props;

  if (query.isLoading) return <Typography>{t('admin.common.loading')}</Typography>;

  if (query.isError) {
    return (
      <Alert severity="error" role="alert">
        {query.error?.message ?? t('app.error')}
      </Alert>
    );
  }

  const rows = query.data;
  if (rows === undefined) return <></>;

  return (
    <TableContainer component={Paper} variant="outlined">
      <Table aria-label={label}>
        <TableHead>
          <TableRow>
            {columns.map((column) => (
              <TableCell key={column.label} align={column.align}>
                {column.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={columns.length}>{t('admin.common.empty')}</TableCell>
            </TableRow>
          )}
          {rows.map((item) => (
            <Fragment key={rowKey(item)}>{renderRow(item)}</Fragment>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
