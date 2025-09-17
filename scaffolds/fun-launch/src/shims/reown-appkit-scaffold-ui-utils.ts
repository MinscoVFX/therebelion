// Shim for '@reown/appkit-scaffold-ui/utils' to prevent build-time module not found errors.
export const WalletUtil = {
  getWallets: (): any[] => [],
  getInstalled: (): any[] => [],
};
export const ConnectorUtil = {
  getConnectors: (): any[] => [],
};
