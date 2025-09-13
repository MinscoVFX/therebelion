import Page from '@/components/ui/Page/Page';
import DbcOneClickExitButton from '@/components/DbcOneClickExitButton';

export default function Exit() {
  return (
    <Page>
      <div className="p-6 space-y-4">
        <h1 className="text-xl font-bold">One-Click Exit Demo</h1>
        <DbcOneClickExitButton
          dbcPoolKeys={{
            pool: 'YOUR_DBC_POOL_PUBKEY',
            feeVault: 'YOUR_DBC_FEE_VAULT_PUBKEY',
          }}
          includeDammV2Exit={false}
        />
      </div>
    </Page>
  );
}
