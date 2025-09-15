import { z } from "zod";

// Official program IDs
const OFFICIAL_DBC_PROGRAM_IDS = ["dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN"];
const OFFICIAL_DAMM_V2_PROGRAM_IDS = ["cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"];

const envSchema = z.object({
  RPC_URL: z.string().min(1, "RPC_URL is required"),
  DBC_CLAIM_FEE_INSTRUCTION_NAME: z.enum(["auto", "claim_creator_trading_fee", "claim_partner_trading_fee"]).optional(),
  DBC_CLAIM_FEE_DISCRIMINATOR: z.string().regex(/^[0-9a-fA-F]{16}$/).optional(),
  ALLOWED_DBC_PROGRAM_IDS: z.string().refine((val) => {
    try {
      const arr = JSON.parse(val);
      return OFFICIAL_DBC_PROGRAM_IDS.every((id) => arr.includes(id));
    } catch {
      return false;
    }
  }, "ALLOWED_DBC_PROGRAM_IDS must include official IDs"),
  ALLOWED_DAMM_V2_PROGRAM_IDS: z.string().refine((val) => {
    try {
      const arr = JSON.parse(val);
      return OFFICIAL_DAMM_V2_PROGRAM_IDS.every((id) => arr.includes(id));
    } catch {
      return false;
    }
  }, "ALLOWED_DAMM_V2_PROGRAM_IDS must include official IDs"),
});

const env = envSchema.safeParse(process.env);

if (process.env.NODE_ENV === "production") {
  if (!env.success) {
    throw new Error(`Env validation failed: ${JSON.stringify(env.error.issues)}`);
  }
  // Check for placeholders/empties
  if (!process.env.RPC_URL || process.env.RPC_URL === "") {
    throw new Error("RPC_URL must be set in production");
  }
}

// Export dbcSelector
export type DbcSelector =
  | { mode: "auto" }
  | { mode: "name"; value: "claim_creator_trading_fee" | "claim_partner_trading_fee" }
  | { mode: "disc"; value: Uint8Array };

export const dbcSelector: DbcSelector = (() => {
  if (process.env.DBC_CLAIM_FEE_INSTRUCTION_NAME === "auto") return { mode: "auto" };
  if (
    process.env.DBC_CLAIM_FEE_INSTRUCTION_NAME === "claim_creator_trading_fee" ||
    process.env.DBC_CLAIM_FEE_INSTRUCTION_NAME === "claim_partner_trading_fee"
  ) {
    return { mode: "name", value: process.env.DBC_CLAIM_FEE_INSTRUCTION_NAME as any };
  }
  if (process.env.DBC_CLAIM_FEE_DISCRIMINATOR) {
    // Anchor discriminator = first 8 bytes of sha256("global:<name>")
    const hex = process.env.DBC_CLAIM_FEE_DISCRIMINATOR;
    const arr = new Uint8Array(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
    return { mode: "disc", value: arr };
  }
  return { mode: "auto" };
})();


export function getEnv() {
  if (!env.success) throw new Error("Env validation failed");
  return env.data;
}
