import {
  createPublicClient,
  encodeFunctionData,
  http,
  isAddress,
  type Address,
  type EstimateFeesPerGasReturnType
} from "viem";
import { mainnet } from "viem/chains";
import {
  createBundlerClient,
  createPaymasterClient,
  createWebAuthnCredential,
  toCoinbaseSmartAccount,
  toWebAuthnAccount
} from "viem/account-abstraction";

export const canonicalRpId = "bindle.me";
export const targetOrigin = "https://bindle.cash";

export type Hex = `0x${string}`;

export type WalletState = {
  status: string;
  smartWalletAddress: string | null;
  railgunAddress: string | null;
  railgunKeyStore: string | null;
  passkeyPresent: boolean;
  mnemonicPresent: boolean;
  createdAt: string | null;
  railgunWalletCreatedAt: string | null;
  railgunWalletImportedAt: string | null;
  lastError: string | null;
  custodyModel: string | null;
  passkeyCredentialId: string | null;
  passkeyPublicKey: Hex | null;
  passkeyRpId?: string | null;
};

export type BindleAccountExport = {
  schema: "me.bindle.account-export";
  version: 1;
  exportedAt: string;
  wallet: WalletState;
  railgunWallet: unknown | null;
  reclaimPlan?: unknown;
  warnings: string[];
  migration?: MigrationRecord;
};

export type MigrationPasskey = {
  id: string;
  publicKey: Hex;
  rpId: string;
  createdAt: string;
};

export type MigrationRecord = {
  sourceRpId: string;
  targetOrigin: string;
  migratedAt: string;
  newPasskeyCredentialId: string;
  newPasskeyPublicKey: Hex;
  smartWalletAddress: string | null;
  userOperationHash?: Hex;
  transactionHash?: Hex | null;
};

export type MigrationEndpoints = {
  ethereumRpcUrl: string;
  bundlerUrl: string;
  paymasterUrl: string;
};

export type MigrationSubmission = {
  userOperationHash: Hex;
  transactionHash: Hex | null;
};

const coinbaseOwnerAbi = [
  {
    inputs: [
      { name: "x", type: "bytes32" },
      { name: "y", type: "bytes32" }
    ],
    name: "addOwnerPublicKey",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function"
  },
  {
    inputs: [{ name: "account", type: "bytes" }],
    name: "isOwnerBytes",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function"
  }
] as const;

let rpcRequestId = 1;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const hexOrNull = (value: unknown): Hex | null =>
  typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value)
    ? (value as Hex)
    : null;

const normalizeWallet = (value: unknown): WalletState => {
  if (!isRecord(value)) {
    throw new Error("Export wallet section is missing.");
  }

  return {
    status: typeof value.status === "string" ? value.status : "none",
    smartWalletAddress: stringOrNull(value.smartWalletAddress),
    railgunAddress: stringOrNull(value.railgunAddress),
    railgunKeyStore: stringOrNull(value.railgunKeyStore),
    passkeyPresent: value.passkeyPresent === true,
    mnemonicPresent: value.mnemonicPresent === true,
    createdAt: stringOrNull(value.createdAt),
    railgunWalletCreatedAt: stringOrNull(value.railgunWalletCreatedAt),
    railgunWalletImportedAt: stringOrNull(value.railgunWalletImportedAt),
    lastError: stringOrNull(value.lastError),
    custodyModel: stringOrNull(value.custodyModel),
    passkeyCredentialId: stringOrNull(value.passkeyCredentialId),
    passkeyPublicKey: hexOrNull(value.passkeyPublicKey),
    passkeyRpId: stringOrNull(value.passkeyRpId)
  };
};

export const parseBindleAccountExport = (
  text: string
): BindleAccountExport => {
  const parsed = JSON.parse(text) as unknown;

  if (!isRecord(parsed)) {
    throw new Error("Account export must be a JSON object.");
  }

  if (parsed.schema !== "me.bindle.account-export" || parsed.version !== 1) {
    throw new Error("Unsupported Bindle account export.");
  }

  const wallet = normalizeWallet(parsed.wallet);

  return {
    schema: "me.bindle.account-export",
    version: 1,
    exportedAt:
      typeof parsed.exportedAt === "string"
        ? parsed.exportedAt
        : new Date().toISOString(),
    wallet,
    railgunWallet: "railgunWallet" in parsed ? parsed.railgunWallet : null,
    reclaimPlan: parsed.reclaimPlan,
    warnings: Array.isArray(parsed.warnings)
      ? parsed.warnings.filter((item): item is string => typeof item === "string")
      : []
  };
};

export const assertMigratableExport = (accountExport: BindleAccountExport) => {
  const { wallet } = accountExport;

  if (!wallet.smartWalletAddress || !isAddress(wallet.smartWalletAddress)) {
    throw new Error("Export does not contain a usable public smart-account address.");
  }

  if (!wallet.passkeyCredentialId || !wallet.passkeyPublicKey) {
    throw new Error("Export does not contain the old passkey credential metadata.");
  }
};

export const createReplacementPasskey = async (): Promise<MigrationPasskey> => {
  const rpId =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
      ? window.location.hostname
      : canonicalRpId;

  const credential = await createWebAuthnCredential({
    name: "Bindle migration",
    rp: {
      id: rpId,
      name: "Bindle"
    },
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      requireResidentKey: false,
      userVerification: "required"
    },
    attestation: "none",
    timeout: 60_000
  });

  return {
    id: credential.id,
    publicKey: credential.publicKey,
    rpId,
    createdAt: new Date().toISOString()
  };
};

export const splitP256PublicKey = (
  publicKey: Hex
): { x: Hex; y: Hex } => {
  const hex = publicKey.slice(2);
  const raw = hex.length === 130 && hex.startsWith("04") ? hex.slice(2) : hex;

  if (raw.length !== 128) {
    throw new Error("Expected a 64-byte P-256 public key.");
  }

  return {
    x: `0x${raw.slice(0, 64)}`,
    y: `0x${raw.slice(64)}`
  };
};

const parseBigIntLike = (value: unknown): bigint | null => {
  if (typeof value === "bigint") {
    return value >= 0n ? value : null;
  }

  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }

  if (typeof value !== "string" || value.trim().startsWith("-")) {
    return null;
  }

  try {
    const parsed = BigInt(value.trim());
    return parsed >= 0n ? parsed : null;
  } catch {
    return null;
  }
};

const isPimlicoBundlerUrl = (url: string): boolean => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "pimlico.io" || host.endsWith(".pimlico.io");
  } catch {
    return false;
  }
};

const requestBundlerRpc = async <Result>(
  bundlerUrl: string,
  method: string
): Promise<Result> => {
  const response = await fetch(bundlerUrl, {
    body: JSON.stringify({
      id: rpcRequestId++,
      jsonrpc: "2.0",
      method,
      params: []
    }),
    headers: { "content-type": "application/json" },
    method: "POST"
  });
  const responseText = await response.text();
  const payload = responseText ? (JSON.parse(responseText) as unknown) : null;

  if (!response.ok) {
    throw new Error(
      `Bundler ${method} failed with HTTP ${response.status}: ${responseText.slice(0, 160)}`
    );
  }

  if (!isRecord(payload)) {
    throw new Error(`Bundler ${method} returned an empty response.`);
  }

  if (isRecord(payload.error)) {
    const code =
      typeof payload.error.code === "number" ? ` ${payload.error.code}` : "";
    const message =
      typeof payload.error.message === "string"
        ? payload.error.message
        : "unknown RPC error";

    throw new Error(`Bundler ${method} error${code}: ${message}`);
  }

  return payload.result as Result;
};

const parsePimlicoGasPrice = (
  response: unknown
): EstimateFeesPerGasReturnType<"eip1559"> | null => {
  if (!isRecord(response)) {
    return null;
  }

  for (const tierName of ["fast", "standard", "slow"]) {
    const tier = response[tierName];

    if (!isRecord(tier)) {
      continue;
    }

    const maxFeePerGas = parseBigIntLike(tier.maxFeePerGas);
    const maxPriorityFeePerGas = parseBigIntLike(tier.maxPriorityFeePerGas);

    if (maxFeePerGas !== null && maxPriorityFeePerGas !== null) {
      return { maxFeePerGas, maxPriorityFeePerGas };
    }
  }

  return null;
};

const estimateVisibleUserOperationFees = async ({
  bundlerUrl,
  fallbackEstimator
}: {
  bundlerUrl: string;
  fallbackEstimator: {
    estimateFeesPerGas: (args: {
      type: "eip1559";
    }) => Promise<EstimateFeesPerGasReturnType<"eip1559">>;
  };
}): Promise<EstimateFeesPerGasReturnType<"eip1559">> => {
  if (isPimlicoBundlerUrl(bundlerUrl)) {
    const result = await requestBundlerRpc<unknown>(
      bundlerUrl,
      "pimlico_getUserOperationGasPrice"
    );
    const parsed = parsePimlicoGasPrice(result);

    if (!parsed) {
      throw new Error("Pimlico bundler did not return usable UserOp gas prices.");
    }

    return parsed;
  }

  return fallbackEstimator.estimateFeesPerGas({ type: "eip1559" });
};

export const submitPasskeyOwnerMigration = async ({
  accountExport,
  endpoints,
  replacementPasskey
}: {
  accountExport: BindleAccountExport;
  endpoints: MigrationEndpoints;
  replacementPasskey: MigrationPasskey;
}): Promise<MigrationSubmission> => {
  assertMigratableExport(accountExport);

  const ethereumRpcUrl = endpoints.ethereumRpcUrl.trim();
  const bundlerUrl = endpoints.bundlerUrl.trim();
  const paymasterUrl = endpoints.paymasterUrl.trim();

  if (!ethereumRpcUrl || !bundlerUrl) {
    throw new Error("Ethereum RPC and ERC-4337 bundler endpoints are required.");
  }

  const smartWalletAddress = accountExport.wallet.smartWalletAddress as Address;
  const client = createPublicClient({
    chain: mainnet,
    transport: http(ethereumRpcUrl)
  });
  const owner = toWebAuthnAccount({
    credential: {
      id: accountExport.wallet.passkeyCredentialId!,
      publicKey: accountExport.wallet.passkeyPublicKey!
    },
    rpId: canonicalRpId
  });
  const account = await toCoinbaseSmartAccount({
    address: smartWalletAddress,
    client,
    owners: [owner],
    version: "1.1"
  });
  const paymaster = paymasterUrl
    ? createPaymasterClient({ transport: http(paymasterUrl) })
    : undefined;
  const bundlerClient = createBundlerClient({
    account,
    client,
    paymaster,
    transport: http(bundlerUrl),
    userOperation: {
      estimateFeesPerGas: () =>
        estimateVisibleUserOperationFees({
          bundlerUrl,
          fallbackEstimator: client
        })
    }
  });
  const { x, y } = splitP256PublicKey(replacementPasskey.publicKey);
  const data = encodeFunctionData({
    abi: coinbaseOwnerAbi,
    functionName: "addOwnerPublicKey",
    args: [x, y]
  });
  const userOperationHash = await bundlerClient.sendUserOperation({
    account,
    calls: [
      {
        to: smartWalletAddress,
        data,
        value: 0n
      }
    ]
  });
  const receipt = await bundlerClient.waitForUserOperationReceipt({
    hash: userOperationHash
  });

  return {
    userOperationHash,
    transactionHash: receipt.receipt.transactionHash
  };
};

export const buildUpdatedAccountExport = ({
  accountExport,
  replacementPasskey,
  submission
}: {
  accountExport: BindleAccountExport;
  replacementPasskey: MigrationPasskey;
  submission: MigrationSubmission | null;
}): BindleAccountExport => {
  const migratedAt = new Date().toISOString();
  const migration: MigrationRecord = {
    sourceRpId: canonicalRpId,
    targetOrigin,
    migratedAt,
    newPasskeyCredentialId: replacementPasskey.id,
    newPasskeyPublicKey: replacementPasskey.publicKey,
    smartWalletAddress: accountExport.wallet.smartWalletAddress,
    userOperationHash: submission?.userOperationHash,
    transactionHash: submission?.transactionHash
  };

  return {
    ...accountExport,
    exportedAt: migratedAt,
    wallet: {
      ...accountExport.wallet,
      passkeyPresent: true,
      passkeyCredentialId: replacementPasskey.id,
      passkeyPublicKey: replacementPasskey.publicKey,
      passkeyRpId: canonicalRpId,
      smartWalletAddress: accountExport.wallet.smartWalletAddress,
      status: accountExport.wallet.railgunAddress
        ? "railgun-ready"
        : "smart-wallet-planned",
      custodyModel: "passkey-4337",
      lastError: null
    },
    migration,
    warnings: [
      ...new Set([
        ...accountExport.warnings,
        "This export contains replacement passkey metadata but not WebAuthn private key material.",
        "Use this export only after the owner-add UserOperation succeeds, or keep the old export until migration is complete.",
        "Bindle on bindle.cash must honor passkeyRpId: bindle.me for this passkey to sign there."
      ])
    ]
  };
};

export const downloadJson = (filename: string, value: unknown) => {
  const blob = new Blob([JSON.stringify(value, null, 2)], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const updatedExportFilename = (
  accountExport: BindleAccountExport
): string => {
  const date = new Date().toISOString().slice(0, 10);
  const address = accountExport.wallet.smartWalletAddress;
  const suffix = address ? address.slice(2, 8) : "local";

  return `bindle-migrated-${suffix}-${date}.json`;
};
