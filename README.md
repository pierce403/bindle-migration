# Bindle Migration

Bindle Migration is a static bridge app for `bindle.me`.

It exists because Bindle originally created WebAuthn passkeys with the current
hostname as the RP ID. Moving the wallet UI to `bindle.cash` means existing
`bindle.me` passkeys do not automatically sign there.

This app keeps the migration boundary explicit:

- import a Bindle account export JSON locally in the browser;
- create a replacement platform passkey scoped to `bindle.me`;
- use the existing `bindle.me` passkey to submit an ERC-4337 UserOperation that
  calls `addOwnerPublicKey` on the Coinbase Smart Wallet;
- download an updated Bindle account export containing the new credential ID,
  public key, and `passkeyRpId: "bindle.me"`.

No backend is used. The app defaults to the same visible public endpoints as the
main Bindle app:

- Ethereum RPC: `https://ethereum-rpc.publicnode.com`
- ERC-4337 bundler: `https://public.pimlico.io/v2/1/rpc`
- Paymaster: off

Those defaults are shown in the UI before submission, labelled as Bindle
defaults, and can be replaced or switched off with Privacy max/custom/local-dev
presets. No analytics, telemetry, hidden endpoints, or silent phone-home are
included.

## Important limitations

- The old `bindle.me` passkey must still be available on the current device.
- The smart account must be the Coinbase Smart Wallet v1.1 path currently used
  by Bindle.
- The main `bindle.cash` wallet must be updated to honor `passkeyRpId` and pass
  it to WebAuthn signing. Without that follow-up, the browser will still default
  to the `bindle.cash` RP ID.
- `public/.well-known/webauthn` allows `https://bindle.cash` to use `bindle.me`
  as a related RP ID where browser support exists.

## Development

```sh
pnpm install
pnpm run typecheck
pnpm run build
```
