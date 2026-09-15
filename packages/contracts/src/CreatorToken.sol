// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title CreatorToken — fixed-supply token launched on NovexCurve
/// @notice The whole supply is minted once to the curve. No owner, no mint,
///         no transfer tax.
contract CreatorToken is ERC20 {
    constructor(string memory name_, string memory symbol_, uint256 supply, address mintTo)
        ERC20(name_, symbol_)
    {
        _mint(mintTo, supply);
    }
}
