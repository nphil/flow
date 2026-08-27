import * as React from 'react';

import { cn } from '@/lib/utils';

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        autoComplete="off"
        className={cn(
          'ui-focus-ring flex h-9 w-full rounded-flow-control border border-flow-border bg-flow-elevated px-3 py-1 font-mono text-[13px] text-flow-text caret-flow-text transition-colors duration-flow-fast file:border-0 file:bg-transparent file:font-medium file:text-flow-text file:text-sm placeholder:text-flow-text-muted hover:border-flow-accent-subtle disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';

export { Input };
