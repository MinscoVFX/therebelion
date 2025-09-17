import { useState } from 'react';
declare const window: any;
import { useIsomorphicLayoutEffect } from 'react-use';

export const useMobile = (width = 1024) => {
  const [isDesktop, setIsDesktop] = useState<boolean>(
    typeof window === 'undefined' ? false : window.matchMedia(`(min-width: ${width}px)`).matches
  );

  useIsomorphicLayoutEffect(() => {
    if (typeof window === 'undefined') {
      return undefined; // SSR safety
    }

    function updateSize() {
      const desktopQuery = window.matchMedia(`(min-width: ${width}px)`);
      setIsDesktop(desktopQuery.matches);
    }

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => {
      window.removeEventListener('resize', updateSize);
    };
  }, [width]);

  // Initially, the state will be false (indicating non-desktop)
  // until the effect runs on the client side.
  return !isDesktop;
};
