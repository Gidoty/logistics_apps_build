"use client";

import { useState, useTransition, type FormEvent } from "react";
import { initialFormState, type FormState } from "@/lib/form-state";

/**
 * Submits a form to a server action without React's automatic form reset, so
 * what the person typed stays in the fields when the server reports errors.
 * The action may redirect on success.
 */
export function useServerForm(action: (prev: FormState, formData: FormData) => Promise<FormState>) {
  const [state, setState] = useState<FormState>(initialFormState);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      setState(await action(initialFormState, formData));
    });
  }

  return { state, pending, onSubmit };
}
