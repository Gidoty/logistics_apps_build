import { Field } from "@/components/forms/form-parts";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

export type RecipientDefaults = Partial<{
  fullName: string;
  phone: string;
  email: string;
  addressLine: string;
  city: string;
  state: string;
  landmark: string;
}>;

type Props = {
  states: string[];
  /** Prefix for field names and ids, so two forms on one page do not clash. */
  prefix?: string;
  errors?: Record<string, string[]>;
  defaults?: RecipientDefaults;
  /** Address fields cannot change once an order uses the recipient. */
  lockAddress?: boolean;
};

/** The fields of a Nigerian recipient. Used by the address book and by the link request form. */
export function RecipientFields({ states, prefix = "", errors = {}, defaults = {}, lockAddress }: Props) {
  const name = (field: string) => `${prefix}${field}`;
  const err = (field: string) => errors[name(field)];
  const locked = lockAddress === true;

  return (
    <div className="grid gap-4">
      <Field id={name("fullName")} label="Recipient's full name" errors={err("fullName")}>
        {(describedBy, invalid) => (
          <Input
            id={name("fullName")}
            name={name("fullName")}
            required
            maxLength={120}
            autoComplete="off"
            defaultValue={defaults.fullName}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>
      <Field
        id={name("phone")}
        label="Recipient's mobile number"
        errors={err("phone")}
        hint="The delivery code is sent here by SMS. Example: 0803 123 4567."
      >
        {(describedBy, invalid) => (
          <Input
            id={name("phone")}
            name={name("phone")}
            type="tel"
            inputMode="tel"
            required
            autoComplete="off"
            defaultValue={defaults.phone}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>
      <Field id={name("email")} label="Recipient's email (optional)" errors={err("email")}>
        {(describedBy, invalid) => (
          <Input
            id={name("email")}
            name={name("email")}
            type="email"
            maxLength={254}
            autoComplete="off"
            defaultValue={defaults.email}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>
      <Field
        id={name("addressLine")}
        label="Street address"
        errors={err("addressLine")}
        hint={
          locked
            ? "The address cannot change because an order uses it. Add a new recipient instead."
            : undefined
        }
      >
        {(describedBy, invalid) => (
          <Input
            id={name("addressLine")}
            name={name("addressLine")}
            required
            maxLength={300}
            autoComplete="off"
            readOnly={locked}
            defaultValue={defaults.addressLine}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={name("city")} label="City or town" errors={err("city")}>
          {(describedBy, invalid) => (
            <Input
              id={name("city")}
              name={name("city")}
              required
              maxLength={80}
              autoComplete="off"
              readOnly={locked}
              defaultValue={defaults.city}
              aria-describedby={describedBy}
              aria-invalid={invalid}
            />
          )}
        </Field>
        <Field id={name("state")} label="State" errors={err("state")}>
          {(describedBy, invalid) =>
            locked ? (
              <>
                <Input
                  id={name("state")}
                  value={defaults.state ?? ""}
                  readOnly
                  aria-describedby={describedBy}
                />
                <input type="hidden" name={name("state")} value={defaults.state ?? ""} />
              </>
            ) : (
              <NativeSelect
                id={name("state")}
                name={name("state")}
                required
                defaultValue={defaults.state ?? ""}
                aria-describedby={describedBy}
                aria-invalid={invalid}
              >
                <option value="" disabled>
                  Choose a state
                </option>
                {states.map((state) => (
                  <option key={state} value={state}>
                    {state}
                  </option>
                ))}
              </NativeSelect>
            )
          }
        </Field>
      </div>
      <Field
        id={name("landmark")}
        label="Landmark (optional)"
        errors={err("landmark")}
        hint="Helps the rider find the place, for example 'opposite the filling station'."
      >
        {(describedBy, invalid) => (
          <Input
            id={name("landmark")}
            name={name("landmark")}
            maxLength={200}
            autoComplete="off"
            defaultValue={defaults.landmark}
            aria-describedby={describedBy}
            aria-invalid={invalid}
          />
        )}
      </Field>
    </div>
  );
}
