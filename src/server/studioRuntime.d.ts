export function getDammV2Runtime(): Promise<any>;
export function getDbcRuntime(): Promise<any>;
export function getRuntimeHealth(): Promise<{ damm_v2: boolean; dbc: boolean }>;
