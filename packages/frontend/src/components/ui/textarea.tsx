import * as React from 'react';

import { cn } from '@/lib/utils';

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<'textarea'>>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'ui-focus-ring flex min-h-[60px] w-full rounded-flow-control border border-flow-border bg-flow-elevated px-3 py-2 font-mono text-[13px] text-flow-text transition-colors duration-flow-fast placeholder:text-flow-text-muted hover:border-flow-accent-subtle disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = 'Textarea';

export { Textarea };
