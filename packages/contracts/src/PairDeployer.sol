// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PairShareToken} from "./PairShareToken.sol";
import {PairVault} from "./PairVault.sol";

/// @title PairDeployer — holds the PairVault + PairShareToken creation code
/// @notice Keeps PairFactory under the 24KB contract size limit. The caller
///         (the factory) owns the new share token and is recorded as the vault's
///         factory; a vault deployed by anyone else is simply not a registered pair.
contract PairDeployer {
    function deploy(PairVault.Config memory cfg, string calldata name, string calldata symbol)
        external
        returns (address pair, address receipt)
    {
        receipt = address(new PairShareToken(name, symbol, msg.sender));
        cfg.receiptToken = receipt;
        cfg.factory = msg.sender;
        pair = address(new PairVault(cfg));
    }
}
