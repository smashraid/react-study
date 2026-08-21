import React, { useState, useId } from 'react';
import { FormStore, FormStoreContext, type FormValues } from './FormStore';
import { useFormField } from './useFormField';

export interface FormProps {
  children: React.ReactNode;
  onSubmit: (values: FormValues) => void;
  initialValues?: FormValues;
}

export function Form({ children, onSubmit, initialValues }: FormProps) {
  // IMPORTANT: [Lazy State Initialization Pattern]
  // Instantiate external class stores via a useState lazy initializer to ensure
  // single-instance creation on mount without render-phase ref mutations.
  const [store] = useState(() => {
    const inst = new FormStore();
    if (initialValues) {
      Object.entries(initialValues).forEach(([k, v]) => {
        inst.setFieldValue(k, v);
      });
    }
    return inst;
  });

  const handleSubmit = (e: React.SubmitEvent) => {
    e.preventDefault();
    onSubmit(store.getSnapshot());
  };

  return (
    // IMPORTANT: [React 19 Direct Context Provider Pattern]
    // React 19 renders Context objects directly as providers without needing .Provider
    <FormStoreContext value={store}>
      <form onSubmit={handleSubmit}>{children}</form>
    </FormStoreContext>
  );
}

export interface FieldProps {
  name: string;
  label: string;
  type?: string;
  renderCountSpy?: () => void;
}

function Field({ name, label, type = 'text', renderCountSpy }: FieldProps) {
  const [value, setValue] = useFormField<string>(name);
  const id = useId();

  if (renderCountSpy) {
    renderCountSpy();
  }

  return (
    <div style={{ marginBottom: '1rem' }}>
      <label htmlFor={id} style={{ display: 'block' }}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value ?? ''}
        onChange={(e) => setValue(e.target.value)}
      />
    </div>
  );
}

function Submit({ children }: { children: React.ReactNode }) {
  return <button type="submit">{children}</button>;
}

// Attach compound sub-components
Form.Field = Field;
Form.Submit = Submit;