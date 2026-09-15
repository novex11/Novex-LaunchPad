// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {PairShareToken} from "./PairShareToken.sol";
import {PairVault} from "./PairVault.sol";

/// @title PairDeployer — creates each pair's PairVault + PairShareToken
/// @notice Keeps PairFactory under the 24KB contract size limit. Every pair is an
///         EIP-1167 minimal proxy of the single implementation deployed here, so
///         the block explorer resolves each launched vault and share token to the
///         verified implementation instantly (name, symbol, ABI, read/write) with
///         no per-launch verification step, and a launch costs a fraction of the
///         gas of deploying the full contracts. The caller (the factory) owns the
///         new share token and is recorded as the vault's factory; a vault
///         deployed by anyone else is simply not a registered pair.
contract PairDeployer {
    /// @notice Verified PairShareToken every launched share token delegates to.
    address public immutable shareTokenImplementation;
    /// @notice Verified PairVault every launched vault delegates to.
    address public immutable vaultImplementation;

    constructor() {
        shareTokenImplementation = address(new PairShareToken());
        vaultImplementation = address(new PairVault());
    }

    function deploy(PairVault.Config memory cfg, string calldata name, string calldata symbol)
        external
        returns (address pair, address receipt)
    {
        receipt = Clones.clone(shareTokenImplementation);
        PairShareToken(receipt).initialize(name, symbol, msg.sender);
        cfg.receiptToken = receipt;
        cfg.factory = msg.sender;
        pair = Clones.clone(vaultImplementation);
        PairVault(pair).initialize(cfg);
    }
}
