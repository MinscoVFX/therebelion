import Page from '@/components/ui/Page/Page';
import DbcOneClickExitButton from '@/components/DbcOneClickExitButton';

export default function ExitPage() {
  return (
    <Page>
      <div className="p-6 space-y-6">
        <h1 className="text-2xl font-bold">One-Click Exit</h1>
        <p className="text-gray-600">
          Click the button below to claim DBC trading fees (and remove all LP on DAMM v2 if migrated).
        </p>

        <DbcOneClickExitButton
          dbcPoolKeys={{
            pool: 'YOUR_DBC_POOL_PUBKEY',
            feeVault: 'YOUR_DBC_FEE_VAULT_PUBKEY',
          }}
          // flip this to true once your DBC pool has been migrated to DAMM v2
          includeDammV2Exit={false}
        />
      </div>
    </Page>
  );
}
