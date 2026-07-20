import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SelectField, toTenantOptions, toValueOptions } from './select-field.js';

import type { Tenant } from '@livechat/shared';

const OPTIONS = toValueOptions(['admin', 'staff']);

describe('SelectField', () => {
  it('exposes a labelled combobox showing the current value', () => {
    render(<SelectField label="Role" value="staff" onChange={() => undefined} options={OPTIONS} />);
    const select = screen.getByLabelText('Role');
    expect(select).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Role' })).toHaveTextContent('staff');
  });

  it('reports the chosen value to onChange', async () => {
    const onChange = vi.fn();
    render(<SelectField label="Role" value="staff" onChange={onChange} options={OPTIONS} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Role' }));
    await userEvent.click(screen.getByRole('option', { name: 'admin' }));
    expect(onChange).toHaveBeenCalledWith('admin');
  });

  it('offers only the supplied options when no empty label is given', async () => {
    render(<SelectField label="Role" value="staff" onChange={() => undefined} options={OPTIONS} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Role' }));
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('prepends an empty-value option when emptyLabel is set', async () => {
    render(
      <SelectField
        label="Tenant"
        value=""
        onChange={() => undefined}
        options={OPTIONS}
        emptyLabel="— none —"
      />,
    );
    await userEvent.click(screen.getByRole('combobox', { name: 'Tenant' }));
    expect(screen.getByRole('option', { name: '— none —' })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });
});

describe('toValueOptions', () => {
  it('uses each value as its own label', () => {
    expect(toValueOptions(['a', 'b'])).toEqual([
      { value: 'a', label: 'a' },
      { value: 'b', label: 'b' },
    ]);
  });
});

describe('toTenantOptions', () => {
  it('labels tenants as "name (slug)" keyed by id', () => {
    const tenants = [{ id: 't1', name: 'Acme', slug: 'acme' }] as Tenant[];
    expect(toTenantOptions(tenants)).toEqual([{ value: 't1', label: 'Acme (acme)' }]);
  });

  it('returns an empty list while tenants are still loading', () => {
    expect(toTenantOptions(undefined)).toEqual([]);
  });
});
