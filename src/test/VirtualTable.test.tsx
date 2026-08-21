import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { VirtualTable } from '../VirtualTable';

describe('Phase 4: Virtualized Windowing Engine', () => {
  it('renders only the visible subset of 100,000 items in the DOM tree', () => {
    // Generate 100,000 mock data items
    const hundredThousandItems = Array.from({ length: 100_000 }, (_, i) => ({
      id: `item-${i}`,
      title: `Row Title ${i}`,
    }));

    render(
      <VirtualTable
        items={hundredThousandItems}
        itemHeight={40}
        containerHeight={400} // Viewport height fits ~10 items + 6 overscan items
        renderRow={(item) => <div data-testid="row-item">{item.title}</div>}
      />
    );

    const renderedNodes = screen.getAllByTestId('row-item');

    // IMPORTANT: [Zero DOM Lag Assert]
    // Confirms that out of 100,000 items, under 20 DOM nodes are actually rendered.
    expect(renderedNodes.length).toBeLessThan(20);
    expect(renderedNodes[0].textContent).toBe('Row Title 0');
  });

  it('recalculates visible window on container scroll without re-rendering offscreen nodes', () => {
    const hundredThousandItems = Array.from({ length: 100_000 }, (_, i) => ({
      id: `item-${i}`,
      title: `Row Title ${i}`,
    }));

    render(
      <VirtualTable
        items={hundredThousandItems}
        itemHeight={40}
        containerHeight={400}
        renderRow={(item) => <div data-testid="row-item">{item.title}</div>}
      />
    );

    const container = screen.getByTestId('virtual-container');

    // Scroll down by 2,000px (moves viewport to item index 50)
    fireEvent.scroll(container, { target: { scrollTop: 2000 } });

    const updatedNodes = screen.getAllByTestId('row-item');

    // Verify row index 0 was unmounted and item 50 is now visible at the top
    expect(screen.queryByText('Row Title 0')).toBeNull();
    expect(screen.getByText('Row Title 50')).toBeDefined();
    expect(updatedNodes.length).toBeLessThan(20);
  });
});