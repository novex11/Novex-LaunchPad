// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title CreatorToken — fixed-supply token launched on ComposeCurve
/// @notice The whole supply is minted once to the curve. No owner, no mint,
///         no transfer tax.
/// @dev Deployed as an EIP-1167 minimal proxy of one verified implementation
///      (see ComposeCurve), so every launched token is recognised by the block
///      explorer as verified the moment it exists. Name and symbol live in this
///      contract's own storage and `initialize` replaces the constructor.
contract CreatorToken is ERC20 {
    bool private _initialized;
    string private _tokenName;
    string private _tokenSymbol;

    /// @dev The implementation itself is locked: only clones can be initialized.
    constructor() ERC20("", "") {
        _initialized = true;
    }

    /// @notice One-time setup of a clone, called by the curve in the launch transaction.
    function initialize(string calldata name_, string calldata symbol_, uint256 supply, address mintTo) external {
        require(!_initialized, "CreatorToken: initialized");
        _initialized = true;
        _tokenName = name_;
        _tokenSymbol = symbol_;
        _mint(mintTo, supply);
    }

    function name() public view override returns (string memory) {
        return _tokenName;
    }

    function symbol() public view override returns (string memory) {
        return _tokenSymbol;
    }
}
