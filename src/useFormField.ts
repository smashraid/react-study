import { useContext, useCallback, useSyncExternalStore } from 'react';
import { FormStoreContext, FormStore } from './FormStore';

export function useFormStore(): FormStore {
  const store = useContext(FormStoreContext);
  if (!store) {
    throw new Error('Form compound components must be rendered inside <Form>');
  }
  return store;
}

// IMPORTANT: [External Store Selector Contract Hook]
// Placing custom hooks in separate files allows Fast Refresh to update UI components
// without re-evaluating hook state definitions.
export function useFormField<T>(name: string): [T, (val: T) => void] {
  const store = useFormStore();

  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(listener),
    [store]
  );

  const getSnapshot = useCallback(
    () => store.getFieldValue(name) as T,
    [store, name]
  );

  const value = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const setValue = useCallback(
    (val: T) => {
      store.setFieldValue(name, val);
    },
    [store, name]
  );

  return [value, setValue];
}