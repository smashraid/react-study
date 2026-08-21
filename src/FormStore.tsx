import { createContext } from 'react';

export type FormValues = Record<string, unknown>;
export type Listener = () => void;

// IMPORTANT: [Isolated State Store Pattern]
// Keeping non-React class stores decoupled from component UI files enables independent 
// testing and ensures Fast Refresh state boundaries remain intact.
export class FormStore {
  private values: FormValues = {};
  private listeners: Set<Listener> = new Set();

  getSnapshot = (): FormValues => this.values;

  getFieldValue = (name: string): unknown => this.values[name];

  setFieldValue = (name: string, value: unknown) => {
    if (this.values[name] === value) return;
    this.values = { ...this.values, [name]: value };
    this.notify();
  };

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private notify() {
    this.listeners.forEach((l) => l());
  }
}

export const FormStoreContext = createContext<FormStore | null>(null);