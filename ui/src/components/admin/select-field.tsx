import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';

import type { Tenant } from '@livechat/shared';

/** One option in a {@link SelectField}. */
export interface SelectOption {
  value: string;
  label: string;
}

interface SelectFieldProps {
  /** Visible label, which also names the control for assistive tech. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  /** When set, prepends an option carrying the empty value, e.g. "— none —". */
  emptyLabel?: string;
  /** Caps the control width; omit to fill the container. */
  maxWidth?: number;
}

/**
 * Labelled `select` field. Wraps MUI's select-mode TextField so admin
 * dropdowns share one keyboard and labelling behaviour.
 * @param props - Label, current value, change handler, and options.
 * @returns The select element.
 */
export function SelectField(props: SelectFieldProps): React.JSX.Element {
  const { label, value, onChange, options, emptyLabel, maxWidth } = props;

  return (
    <TextField
      select
      label={label}
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
      }}
      fullWidth={maxWidth === undefined}
      sx={maxWidth === undefined ? undefined : { maxWidth }}
    >
      {emptyLabel !== undefined && <MenuItem value="">{emptyLabel}</MenuItem>}
      {options.map((option) => (
        <MenuItem key={option.value} value={option.value}>
          {option.label}
        </MenuItem>
      ))}
    </TextField>
  );
}

/**
 * Builds select options from a plain value list, using each value as its
 * own label — used for role and status enums.
 * @param values - The enum values to offer.
 * @returns Options suitable for {@link SelectField}.
 */
export function toValueOptions(values: readonly string[]): SelectOption[] {
  return values.map((value) => ({ value, label: value }));
}

/**
 * Builds tenant select options labelled `name (slug)`.
 * @param tenants - Tenants to offer, or undefined while loading.
 * @returns Options suitable for {@link SelectField}.
 */
export function toTenantOptions(tenants: Tenant[] | undefined): SelectOption[] {
  return (tenants ?? []).map((tenant) => ({
    value: tenant.id,
    label: `${tenant.name} (${tenant.slug})`,
  }));
}
