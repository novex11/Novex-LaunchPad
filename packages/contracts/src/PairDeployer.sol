// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {PairVault} from "./PairVault.sol";

/// @title PairDeployer — creates each pair's PairVault
/// @notice Keeps PairFactory under the 24KB contract size limit. Every vault is an
///         EIP-1167 minimal proxy of the single implementation deployed here, so
///         the block explorer resolves each launched vault (which is also the
///         pair's share token) to the verified implementation instantly — name,
///         symbol, ABI, read/write — with no per-launch verification step, and a
///         launch costs a fraction of the gas of deploying the full contract. The
///         caller (the factory) is recorded as the vault's factory; a vault
///         deployed by anyone else is simply not a registered pair. The vault is
///         its own ERC-20 share token, so `receipt` always equals `pair`.
contract PairDeployer {
    /// @notice Verified PairVault every launched vault delegates to.
    address public immutable vaultImplementation;

    constructor() {
        vaultImplementation = address(new PairVault());
    }

    function deploy(PairVault.Config memory cfg, string calldata name, string calldata symbol)
        external
        returns (address pair, address receipt)
    {
        cfg.factory = msg.sender;
        pair = Clones.clone(vaultImplementation);
        PairVault(pair).initialize(cfg, name, symbol);
        receipt = pair;
    }
}
