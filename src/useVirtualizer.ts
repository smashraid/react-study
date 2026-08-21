import { useState, useCallback } from 'react';

export interface UseVirtualizerOptions {
  count: number;
  itemHeight: number;
  containerHeight: number;
  overscan?: number;
}

export interface VirtualItem {
  index: number;
  offsetTop: number;
}

export function useVirtualizer({
  count,
  itemHeight,
  containerHeight,
  overscan = 3,
}: UseVirtualizerOptions) {
  const [scrollTop, setScrollTop] = useState(0);

  // IMPORTANT: [Virtual Windowing Calculation Pattern]
  // Calculates visible range in O(1) time complexity based on scroll position,
  // completely bypassing full array iterations for massive datasets.
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(
    count - 1,
    Math.floor((scrollTop + containerHeight) / itemHeight) + overscan
  );

  const totalHeight = count * itemHeight;

  const virtualItems: VirtualItem[] = [];
  for (let i = startIndex; i <= endIndex; i++) {
    virtualItems.push({
      index: i,
      offsetTop: i * itemHeight,
    });
  }

  // IMPORTANT: [Unthrottled Scroll Event Boundary]
  // React 18+ automatic batching safely processes scrollTop state updates synchronously 
  // with browser frame paints without lag.
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  return {
    virtualItems,
    totalHeight,
    handleScroll,
  };
}