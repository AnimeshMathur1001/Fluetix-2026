import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

const button = cva(
  'inline-flex items-center justify-center gap-2 rounded font-sans transition-all duration-120 disabled:cursor-not-allowed disabled:opacity-40',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-[#07100f] font-semibold hover:brightness-110 active:brightness-95',
        secondary: 'border border-line2 bg-field text-dim hover:border-white/20 hover:text-ink hover:shadow-raise',
        outline: 'border border-accent/35 bg-field text-accent hover:border-accent/60 hover:bg-accent/5',
        ghost: 'text-mute2 hover:text-ink',
      },
      size: {
        sm: 'px-2.5 py-1.5 text-tiny',
        md: 'px-3 py-2 text-base2',
        block: 'w-full px-3 py-2.5 text-base2',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>;

export default function ActionButton({ variant, size, className, ...rest }: ActionButtonProps) {
  return <button type="button" className={cn(button({ variant, size }), className)} {...rest} />;
}
