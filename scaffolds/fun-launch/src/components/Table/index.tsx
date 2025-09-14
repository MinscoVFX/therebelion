import { cn } from '@/lib/utils';
import * as React from 'react';
import PropTypes from 'prop-types';

const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, children, ...props }, ref) => (
    <table ref={ref} className={cn('sm w-full caption-bottom', className)} {...props}>
      {children}
    </table>
  )
);
Table.displayName = 'Table';
Table.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
};
Table.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
};

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, children, ...props }, ref) => (
  <thead ref={ref} className={cn('whitespace-nowrap', className)} {...props}>
    {children}
  </thead>
));
TableHeader.displayName = 'TableHeader';
TableHeader.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
};
TableHeader.propTypes = {
  className: PropTypes.string,
  children: PropTypes.node,
};

type TableBodyProps = React.ComponentProps<'tbody'>;
const TableBody = React.forwardRef<HTMLTableSectionElement, TableBodyProps>(
  ({ className, ...props }, ref) => <tbody ref={ref} className={cn(className)} {...props} />
);
TableBody.displayName = 'TableBody';
TableBody.propTypes = {
  className: PropTypes.string,
};

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot ref={ref} className={cn('font-medium', className)} {...props} />
));
TableFooter.displayName = 'TableFooter';
TableFooter.propTypes = {
  className: PropTypes.string,
};

type TableRowProps = React.ComponentProps<'tr'> & {
  // We use shadow to display the bottom border if this is a sticky row
  isSticky?: boolean;
};
const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ className, isSticky, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'h-10 transition-colors',
        {
          'border-b border-b-neutral-900': !isSticky,
          'shadow-[0_1px_0_0_theme(colors.neutral.900)]': isSticky,
        },
        className
      )}
      {...props}
    />
  )
);
TableRow.displayName = 'TableRow';
TableRow.propTypes = {
  className: PropTypes.string,
  isSticky: PropTypes.bool,
};

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'h-8 whitespace-nowrap px-1 text-left align-middle font-medium text-neutral-500 sm:h-10 sm:px-2',
      className
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';
TableHead.propTypes = {
  className: PropTypes.string,
};

const TableCellForwardRef = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    // NOTE: table-cell required for `colSpan` attribute to work
    className={cn('table-cell whitespace-nowrap px-1 align-middle sm:px-2', className)}
    {...props}
  />
));

TableCellForwardRef.displayName = 'TableCell';

const TableCell = React.memo(TableCellForwardRef);
TableCell.displayName = 'TableCell';

export { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow };
