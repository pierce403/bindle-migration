import { useMemo, useState } from "react";
import {
  assertMigratableExport,
  buildUpdatedAccountExport,
  canonicalRpId,
  createReplacementPasskey,
  downloadJson,
  parseBindleAccountExport,
  submitPasskeyOwnerMigration,
  targetOrigin,
  updatedExportFilename,
  type BindleAccountExport,
  type MigrationEndpoints,
  type MigrationPasskey,
  type MigrationSubmission
} from "./migration";

const defaultEndpoints: MigrationEndpoints = {
  ethereumRpcUrl: "",
  bundlerUrl: "",
  paymasterUrl: ""
};

const shorten = (value: string | null | undefined): string =>
  value && value.length > 18
    ? `${value.slice(0, 10)}...${value.slice(-6)}`
    : (value ?? "not present");

const endpointMode = (value: string, required = true) => {
  if (!value.trim()) {
    return required ? "required" : "off";
  }

  try {
    const url = new URL(value.trim());
    return url.hostname === "localhost" || url.hostname === "127.0.0.1"
      ? "local"
      : "custom";
  } catch {
    return "invalid";
  }
};

const readFile = async (file: File): Promise<string> => file.text();

export default function App() {
  const [accountExport, setAccountExport] =
    useState<BindleAccountExport | null>(null);
  const [importText, setImportText] = useState("");
  const [replacementPasskey, setReplacementPasskey] =
    useState<MigrationPasskey | null>(null);
  const [submission, setSubmission] = useState<MigrationSubmission | null>(null);
  const [endpoints, setEndpoints] =
    useState<MigrationEndpoints>(defaultEndpoints);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const migratable = useMemo(() => {
    if (!accountExport) {
      return { ok: false, message: "Import a Bindle account export first." };
    }

    try {
      assertMigratableExport(accountExport);
      return { ok: true, message: "Old smart-account metadata is present." };
    } catch (cause) {
      return {
        ok: false,
        message: cause instanceof Error ? cause.message : "Export is not migratable."
      };
    }
  }, [accountExport]);

  const canSubmit =
    migratable.ok &&
    replacementPasskey !== null &&
    endpoints.ethereumRpcUrl.trim().length > 0 &&
    endpoints.bundlerUrl.trim().length > 0 &&
    !busy;

  const handleImportText = () => {
    setError("");
    setStatus("");

    try {
      const parsed = parseBindleAccountExport(importText);
      setAccountExport(parsed);
      setSubmission(null);
      setStatus("Account export imported locally.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to import export.");
    }
  };

  const handleFile = async (file: File | null) => {
    if (!file) {
      return;
    }

    setError("");
    setStatus("");

    try {
      const text = await readFile(file);
      setImportText(text);
      const parsed = parseBindleAccountExport(text);
      setAccountExport(parsed);
      setSubmission(null);
      setStatus("Account export imported locally.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to import export.");
    }
  };

  const handleCreatePasskey = async () => {
    setError("");
    setStatus("Creating replacement passkey.");
    setBusy(true);

    try {
      const credential = await createReplacementPasskey();
      setReplacementPasskey(credential);
      setSubmission(null);
      setStatus(`Replacement passkey created for RP ID ${credential.rpId}.`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to create replacement passkey."
      );
      setStatus("");
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async () => {
    if (!accountExport || !replacementPasskey) {
      return;
    }

    const confirmed = window.confirm(
      [
        "This will ask the old bindle.me passkey to sign a UserOperation.",
        "It may contact the Ethereum RPC, ERC-4337 bundler, and optional paymaster shown on this page.",
        "The call adds the replacement passkey public key as an owner of the existing Coinbase Smart Wallet."
      ].join("\n\n")
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setStatus("Submitting owner-add UserOperation.");
    setBusy(true);

    try {
      const result = await submitPasskeyOwnerMigration({
        accountExport,
        endpoints,
        replacementPasskey
      });
      setSubmission(result);
      setStatus("Owner-add UserOperation confirmed.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Owner-add UserOperation failed."
      );
      setStatus("");
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = () => {
    if (!accountExport || !replacementPasskey) {
      return;
    }

    downloadJson(
      updatedExportFilename(accountExport),
      buildUpdatedAccountExport({
        accountExport,
        replacementPasskey,
        submission
      })
    );
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="brand-mark">B</div>
        <div>
          <p className="kicker">bindle.me migration bridge</p>
          <h1>Move passkey access without hiding the sharp edges.</h1>
          <p>
            Import a Bindle export, create a replacement passkey, and add it as
            an owner of the same public smart account. Everything runs locally
            except the explicit endpoints you paste below.
          </p>
        </div>
      </section>

      <section className="notice">
        <strong>How this works</strong>
        <span>
          This page is intended to live on <code>bindle.me</code>, the old
          WebAuthn RP ID. It serves <code>/.well-known/webauthn</code> so{" "}
          <code>bindle.cash</code> can use <code>bindle.me</code> as a related
          RP ID after the wallet app is updated to honor{" "}
          <code>passkeyRpId</code>.
        </span>
      </section>

      <div className="grid">
        <section className="panel">
          <div className="panel-heading">
            <span>1</span>
            <div>
              <h2>Import account export</h2>
              <p>Only local browser memory reads this JSON.</p>
            </div>
          </div>
          <label className="file-input">
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => void handleFile(event.currentTarget.files?.[0] ?? null)}
            />
            Choose Bindle export JSON
          </label>
          <textarea
            value={importText}
            onChange={(event) => setImportText(event.currentTarget.value)}
            placeholder="Or paste a Bindle account export JSON here."
          />
          <button onClick={handleImportText} disabled={!importText.trim()}>
            Import pasted JSON
          </button>
          <div className={migratable.ok ? "check ok" : "check"}>
            {migratable.message}
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <span>2</span>
            <div>
              <h2>Create replacement passkey</h2>
              <p>Private key material stays inside the platform authenticator.</p>
            </div>
          </div>
          <dl className="facts">
            <div>
              <dt>Canonical RP ID</dt>
              <dd>{canonicalRpId}</dd>
            </div>
            <div>
              <dt>Target origin</dt>
              <dd>{targetOrigin}</dd>
            </div>
            <div>
              <dt>Replacement credential</dt>
              <dd>{shorten(replacementPasskey?.id)}</dd>
            </div>
          </dl>
          <button onClick={handleCreatePasskey} disabled={busy || !migratable.ok}>
            {busy ? "Working" : "Create replacement passkey"}
          </button>
        </section>
      </div>

      <section className="panel wide">
        <div className="panel-heading">
          <span>3</span>
          <div>
            <h2>Review account and endpoints</h2>
            <p>No default infrastructure is embedded in this migration app.</p>
          </div>
        </div>
        <div className="summary-grid">
          <div className="summary-card">
            <span>Public smart account</span>
            <strong>{shorten(accountExport?.wallet.smartWalletAddress)}</strong>
          </div>
          <div className="summary-card">
            <span>Old passkey credential</span>
            <strong>{shorten(accountExport?.wallet.passkeyCredentialId)}</strong>
          </div>
          <div className="summary-card">
            <span>Shielded address</span>
            <strong>{shorten(accountExport?.wallet.railgunAddress)}</strong>
          </div>
          <div className="summary-card">
            <span>New public key</span>
            <strong>{shorten(replacementPasskey?.publicKey)}</strong>
          </div>
        </div>
        <div className="endpoint-grid">
          <label>
            <span>Ethereum execution RPC</span>
            <input
              value={endpoints.ethereumRpcUrl}
              onChange={(event) =>
                setEndpoints((current) => ({
                  ...current,
                  ethereumRpcUrl: event.currentTarget.value
                }))
              }
              placeholder="https://..."
            />
            <small>{endpointMode(endpoints.ethereumRpcUrl)}</small>
          </label>
          <label>
            <span>ERC-4337 bundler</span>
            <input
              value={endpoints.bundlerUrl}
              onChange={(event) =>
                setEndpoints((current) => ({
                  ...current,
                  bundlerUrl: event.currentTarget.value
                }))
              }
              placeholder="https://..."
            />
            <small>{endpointMode(endpoints.bundlerUrl)}</small>
          </label>
          <label>
            <span>ERC-4337 paymaster</span>
            <input
              value={endpoints.paymasterUrl}
              onChange={(event) =>
                setEndpoints((current) => ({
                  ...current,
                  paymasterUrl: event.currentTarget.value
                }))
              }
              placeholder="optional"
            />
            <small>{endpointMode(endpoints.paymasterUrl, false)}</small>
          </label>
        </div>
      </section>

      <section className="panel wide action-panel">
        <div>
          <h2>Submit migration</h2>
          <p>
            The UserOperation calls <code>addOwnerPublicKey</code> on the
            existing Coinbase Smart Wallet. The old passkey signs; the new
            passkey is added as an owner.
          </p>
        </div>
        <div className="actions">
          <button onClick={handleSubmit} disabled={!canSubmit}>
            {busy ? "Submitting" : "Submit owner update"}
          </button>
          <button
            className="secondary"
            onClick={handleDownload}
            disabled={!accountExport || !replacementPasskey}
          >
            Download updated export
          </button>
        </div>
        {submission ? (
          <div className="receipt">
            <span>UserOperation</span>
            <strong>{submission.userOperationHash}</strong>
            <span>Transaction</span>
            <strong>{submission.transactionHash ?? "not available"}</strong>
          </div>
        ) : null}
      </section>

      {status ? <div className="toast">{status}</div> : null}
      {error ? <div className="toast error">{error}</div> : null}
    </main>
  );
}
