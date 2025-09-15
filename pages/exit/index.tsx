export default function ExitPage() {
  return (
    <div>
      <h1>Claim Fees Only</h1>
      <p className="text-sm opacity-80">
        Withdraws are temporarily disabled. You can claim fees; withdraw returns HTTP 501 by design.
      </p>
      {/* Withdraw UI removed/disabled; keep Claim flow intact */}
    </div>
  );
}
