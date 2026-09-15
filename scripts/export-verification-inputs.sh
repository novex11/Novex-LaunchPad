#!/usr/bin/env bash
# Writes explorer verification inputs (standard JSON) for the three implementation
# contracts every launched pair and token delegates to: PairVault, PairShareToken
# (both held by PairDeployer) and CreatorToken (held by ComposeCurve). Launched
# contracts are EIP-1167 clones, which the explorer shows as verified as soon as the
# implementation is, so these three are the only sources ever submitted. The indexer
# submits them on boot; `pnpm verify:implementations[:mainnet]` does it from the CLI.
#
# Re-run (and commit the output) after changing any of those contracts, their
# imports or the compiler settings.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
# foundry.toml references ETHERSCAN_API_KEY; Blockscout does not need a real key.
export ETHERSCAN_API_KEY="${ETHERSCAN_API_KEY:-blockscout}"

OUT="$ROOT/services/indexer/verification"
mkdir -p "$OUT"

cd "$ROOT/packages/contracts"
forge build --no-lint >/dev/null

for name in PairVault PairShareToken CreatorToken; do
  forge verify-contract 0x0000000000000000000000000000000000000001 "src/$name.sol:$name" \
    --verifier blockscout --show-standard-json-input > "$OUT/$name.input.json"
done
rm -f "$OUT/ReceiptToken.input.json"

node -e '
const fs = require("fs");
const artifact = JSON.parse(fs.readFileSync("out/PairVault.sol/PairVault.json", "utf8"));
const metadata = typeof artifact.metadata === "object" ? artifact.metadata : JSON.parse(artifact.rawMetadata);
const compilerVersion = "v" + metadata.compiler.version;
fs.writeFileSync(process.argv[1], JSON.stringify({ compilerVersion }, null, 2) + "\n");
console.log("compiler", compilerVersion);
' "$OUT/compiler.json"

echo "✅  Verification inputs written to services/indexer/verification"
