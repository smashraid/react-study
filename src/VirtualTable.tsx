import React from 'react';
import { useVirtualizer } from './useVirtualizer';

export interface VirtualTableProps<T> {
  items: T[];
  itemHeight: number;
  containerHeight: number;
  renderRow: (item: T, index: number) => React.ReactNode;
}

export function VirtualTable<T>({
  items,
  itemHeight,
  containerHeight,
  renderRow,
}: VirtualTableProps<T>) {
  const { virtualItems, totalHeight, handleScroll } = useVirtualizer({
    count: items.length,
    itemHeight,
    containerHeight,
  });

  return (
    <div
      data-testid="virtual-container"
      onScroll={handleScroll}
      style={{
        height: containerHeight,
        overflowY: 'auto',
        position: 'relative',
      }}
    >
      {/* IMPORTANT: [Phantom Spacer Pattern]
          A blank inner container with explicit full dataset height forces the browser 
          scrollbar to accurately reflect 100,000 items while keeping real DOM nodes low. */}
      <div style={{ height: totalHeight, width: '100%', position: 'relative' }}>
        {virtualItems.map(({ index, offsetTop }) => (
          // IMPORTANT: [Hardware-Accelerated Positioning Strategy]
          // Using translateY CSS transforms forces GPU layer promotion and eliminates 
          // browser repaint reflows during rapid scrolling.
          <div
            key={index}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              transform: `translateY(${offsetTop}px)`,
              height: itemHeight,
              width: '100%',
            }}
          >
            {renderRow(items[index], index)}
          </div>
        ))}
      </div>
    </div>
  );
}