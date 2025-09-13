import Page from '@/components/ui/Page/Page';
import OneClickExitAutoButton from '@/components/OneClickExitAutoButton';

export default function ExitPage() {
  return (
    <Page>
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold">One-Click Exit</h1>
        <p className="text-gray-600">
          This will auto-detect your DAMM v2 LP position (from your connected wallet) and remove 100%.
        </p>

        <OneClickExitAutoButton />
      </div>
    </Page>
  );
}
