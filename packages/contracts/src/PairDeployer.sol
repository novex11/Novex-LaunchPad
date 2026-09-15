// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PairVault} from "./PairVault.sol";

/// @title PairDeployer — holds the PairVault creation code
/// @notice Keeps PairFactory under the 24KB contract size limit. The caller
///         (the factory) is recorded as the vault's factory; a vault deployed by
///         anyone else is simply not a registered pair. The vault is its own
///         ERC-20 share token, so `receipt` always equals `pair`.
contract PairDeployer {
    function deploy(PairVault.Config memory cfg, string calldata name, string calldata symbol)
        external
        returns (address pair, address receipt)
    {
        cfg.factory = msg.sender;
        pair = address(new PairVault(cfg, name, symbol));
        receipt = pair;
    }
}
