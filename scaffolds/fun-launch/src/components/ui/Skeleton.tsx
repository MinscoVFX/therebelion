import { cn } from '@/lib/utils';
import { cva, type VariantProps } from 'class-variance-authority';
import PropTypes from 'prop-types';

const skeletonVariants = cva('h-12 w-full rounded-lg bg-[var(--tw-gradient-from)]', {
  variants: {
    variant: {
      shimmer:
        'animate-shine-reverse !bg-[linear-gradient(90deg,var(--tw-gradient-to),var(--tw-gradient-from)_40%,var(--tw-gradient-from)_60%,var(--tw-gradient-to))] bg-200-auto',
      pulse: 'animate-pulse',
    },
    color: {
      default: 'from-neutral-800 to-neutral-750',
      muted: ' from-neutral-900 to-neutral-850',
    },
  },
  defaultVariants: {
    variant: 'shimmer',
    color: 'default',
  },
});

type SkeletonProps = React.ComponentPropsWithoutRef<'div'> & VariantProps<typeof skeletonVariants>;

export const Skeleton: React.FC<SkeletonProps> = ({ variant, color, className, ...props }) => {
  return <div className={cn(skeletonVariants({ variant, color }), className)} {...props} />;
};
Skeleton.propTypes = {
  variant: PropTypes.string,
  color: PropTypes.string,
  className: PropTypes.string,
};
Skeleton.propTypes = {
  variant: PropTypes.string,
  color: PropTypes.string,
  className: PropTypes.string,
};
