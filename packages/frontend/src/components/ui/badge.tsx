import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'ui-focus-ring inline-flex items-center rounded-full border px-2.5 py-0.5 font-semibold text-xs transition-colors duration-flow-fast',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-flow-accent text-flow-on-accent hover:bg-flow-accent-hover',
        secondary: 'border-transparent bg-flow-elevated text-flow-text hover:opacity-80',
        destructive: 'border-transparent bg-flow-danger text-flow-on-accent hover:opacity-90',
        outline: 'text-flow-text',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
