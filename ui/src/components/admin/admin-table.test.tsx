import TableCell from '@mui/material/TableCell';
import TableRow from '@mui/material/TableRow';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it } from 'vitest';

import { initI18n } from '../../i18n/index.js';

import { AdminTable } from './admin-table.js';

import type { AdminTableColumn, AdminTableQuery } from './admin-table.js';

const i18n = initI18n();

interface Row {
  id: string;
  name: string;
}

const COLUMNS: AdminTableColumn[] = [{ label: 'Name' }, { label: 'Actions', align: 'right' }];

function renderTable(query: AdminTableQuery<Row>): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={i18n}>
      <AdminTable
        label="Widgets"
        columns={COLUMNS}
        query={query}
        rowKey={(row) => row.id}
        renderRow={(row) => (
          <TableRow>
            <TableCell>{row.name}</TableCell>
            <TableCell align="right">—</TableCell>
          </TableRow>
        )}
      />
    </I18nextProvider>,
  );
}

const IDLE = { isLoading: false, isError: false, error: null };

describe('AdminTable', () => {
  it('names the table for assistive tech and exposes each column header', () => {
    renderTable({ ...IDLE, data: [{ id: '1', name: 'Alpha' }] });
    expect(screen.getByRole('table', { name: 'Widgets' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
  });

  it('renders one row per item', () => {
    renderTable({
      ...IDLE,
      data: [
        { id: '1', name: 'Alpha' },
        { id: '2', name: 'Beta' },
      ],
    });
    expect(screen.getByRole('cell', { name: 'Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Beta' })).toBeInTheDocument();
  });

  it('shows the empty message instead of rows when the list is empty', () => {
    renderTable({ ...IDLE, data: [] });
    expect(screen.getByRole('cell', { name: 'No results' })).toBeInTheDocument();
  });

  it('shows a loading message and no table while loading', () => {
    renderTable({ isLoading: true, isError: false, error: null, data: undefined });
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('announces query errors through an alert', () => {
    renderTable({
      isLoading: false,
      isError: true,
      error: new Error('Tenant lookup failed'),
      data: undefined,
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Tenant lookup failed');
  });

  it('falls back to the generic error text when the error carries no message', () => {
    renderTable({ isLoading: false, isError: true, error: null, data: undefined });
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  });
});
