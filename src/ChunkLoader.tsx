import React from 'react';

export interface ChunkLoaderProps<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
  fallback?: React.ReactNode;
  children: (data: T) => React.ReactNode;
}

export function ChunkLoader<T>({
  data,
  isLoading,
  error,
  fallback = <div>Loading chunk...</div>,
  children,
}: ChunkLoaderProps<T>) {
  if (isLoading) {
    return <>{fallback}</>;
  }

  if (error) {
    return (
      <div role="alert" style={{ color: 'red' }}>
        Failed to load chunk: {error.message}
      </div>
    );
  }

  if (data === null) {
    return null;
  }

  return <>{children(data)}</>;
}