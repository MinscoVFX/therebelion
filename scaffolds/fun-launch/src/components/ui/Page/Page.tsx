import Header from '@/components/Header';
import { cn } from '@/lib/utils';
import PropTypes from 'prop-types';

interface IProps {
  containerClassName?: string;
  pageClassName?: string;
}

const Page: React.FC<React.PropsWithChildren<IProps>> = ({
  containerClassName,
  children,
  pageClassName,
}) => {
  return (
    <div
      className={cn(
        'flex min-h-screen flex-col justify-between bg-black text-white',
        pageClassName
      )}
    >
      <Header />
      <div
        className={cn(
          'flex flex-1 flex-col items-center px-1 md:px-3 pt-4 pb-16',
          containerClassName
        )}
      >
        <div className="lg:max-w-7xl w-full">{children}</div>
      </div>
    </div>
  );
};

Page.propTypes = {
  containerClassName: PropTypes.string,
  pageClassName: PropTypes.string,
  children: PropTypes.node,
};
export default Page;
