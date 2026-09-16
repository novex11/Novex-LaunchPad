// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";

/// @title VaultMixes — reads the fixed target mix of a basket vault from JSON
/// @notice `scripts/build-vault-mixes.ts` computes one Balanced mix per deposit
///         ticker with the same allocator the app uses and writes
///         `vault-mixes-<chainId>.json`:
///           { "chainId": 4663, "strategy": "balanced",
///             "mixes": { "NVDA": { "tickers": [...], "tokens": [...], "weightsBps": [...] } } }
///         Deploy scripts read the mix for each vault they create so the on-chain
///         basket is exactly what the app previews.
library VaultMixes {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function path(uint256 chainId) internal pure returns (string memory) {
        return string.concat("./vault-mixes-", vm.toString(chainId), ".json");
    }

    /// @dev Balanced mixes keep the original file name; other strategies add a suffix.
    function path(uint256 chainId, string memory strategy) internal pure returns (string memory) {
        if (keccak256(bytes(strategy)) == keccak256("balanced")) return path(chainId);
        return string.concat("./vault-mixes-", vm.toString(chainId), "-", strategy, ".json");
    }

    function load(uint256 chainId) internal view returns (string memory json) {
        return load(chainId, "balanced");
    }

    /// @dev Reverts when the file is missing so a deploy never silently creates
    ///      vaults without a mix.
    function load(uint256 chainId, string memory strategy) internal view returns (string memory json) {
        string memory p = path(chainId, strategy);
        require(vm.exists(p), string.concat("VaultMixes: missing ", p, " (run pnpm mixes:<network>)"));
        json = vm.readFile(p);
        require(vm.parseJsonUint(json, ".chainId") == chainId, "VaultMixes: wrong chain in mixes json");
        require(
            keccak256(bytes(vm.parseJsonString(json, ".strategy"))) == keccak256(bytes(strategy)),
            string.concat("VaultMixes: ", p, " is not a ", strategy, " mix file")
        );
    }

    function has(string memory json, string memory ticker) internal view returns (bool) {
        return vm.keyExistsJson(json, string.concat(".mixes.", ticker));
    }

    function get(string memory json, string memory ticker)
        internal
        view
        returns (address[] memory tokens, uint256[] memory weightsBps)
    {
        string memory key = string.concat(".mixes.", ticker);
        tokens = vm.parseJsonAddressArray(json, string.concat(key, ".tokens"));
        weightsBps = vm.parseJsonUintArray(json, string.concat(key, ".weightsBps"));
        require(tokens.length > 0 && tokens.length == weightsBps.length, "VaultMixes: malformed mix");
        uint256 total;
        for (uint256 i; i < weightsBps.length; ++i) total += weightsBps[i];
        require(total == 10_000, "VaultMixes: weights must sum to 10000");
    }
}
