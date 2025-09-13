import React from 'react';
// Use relative paths to avoid tsconfig path alias issues in CI
import Page from '../../components/ui/Page/Page';
import OneClickExitAutoButton from '../../components/OneClickExitAutoButton';

export default function ExitPage(): JSX.Element {
  return (
    <Page>
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold">One-Click Exit</h1>
        <OneClickExitAutoButton />
      </div>
    </Page>
  );
}
