import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Form } from '../FormEngine';

describe('Phase 2: Schema Form Engine (Compound Components & Context Selectors)', () => {
  it('submits accumulated uncontrolled field values', () => {
    const handleSubmit = vi.fn();

    render(
      <Form onSubmit={handleSubmit} initialValues={{ firstName: 'John' }}>
        <Form.Field name="firstName" label="First Name" />
        <Form.Field name="lastName" label="Last Name" />
        <Form.Submit>Save</Form.Submit>
      </Form>
    );

    const lastNameInput = screen.getByLabelText('Last Name');
    fireEvent.change(lastNameInput, { target: { value: 'Doe' } });

    fireEvent.click(screen.getByText('Save'));

    // IMPORTANT: [Uncontrolled Accumulation Assert]
    // Verifies that the store accumulated field state across inputs without forcing parent component re-renders
    expect(handleSubmit).toHaveBeenCalledWith({
      firstName: 'John',
      lastName: 'Doe',
    });
  });

  it('prevents cascade re-renders across sibling form fields', () => {
    const fieldASpy = vi.fn();
    const fieldBSpy = vi.fn();

    render(
      <Form onSubmit={vi.fn()}>
        <Form.Field name="fieldA" label="Field A" renderCountSpy={fieldASpy} />
        <Form.Field name="fieldB" label="Field B" renderCountSpy={fieldBSpy} />
      </Form>
    );

    // Clear initial mount render counts
    fieldASpy.mockClear();
    fieldBSpy.mockClear();

    // Type into Field A
    const inputA = screen.getByLabelText('Field A');
    fireEvent.change(inputA, { target: { value: 'Hello' } });

    // IMPORTANT: [Isolated Field Render Assert]
    // Field A MUST re-render to show input value changes, but Field B MUST NOT re-render
    expect(fieldASpy).toHaveBeenCalledTimes(1);
    expect(fieldBSpy).not.toHaveBeenCalled();
  });

  it('throws a descriptive error when compound components are used outside <Form>', () => {
    // IMPORTANT: [Error Boundary & Scope Protection Assert]
    // Suppress expected React console error logs during intentional error throwing
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<Form.Field name="orphan" label="Orphan Field" />);
    }).toThrow('Form compound components must be rendered inside <Form>');

    consoleSpy.mockRestore();
  });
});