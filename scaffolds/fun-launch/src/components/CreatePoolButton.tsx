import Link from 'next/link';
import { Button } from './ui/button';

export const CreatePoolButton = () => {
  return (
    <Button>
      <Link href="/create-pool" className="flex items-center gap-1">
        <span className="iconify ph--rocket-bold w-4 h-4" />
        <span>Create Pool</span>
      </Link>
    </Button>
  );
};
