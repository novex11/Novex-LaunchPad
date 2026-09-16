// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ReceiptToken — non-transferable vault share token (tTSLA-B etc.)
contract ReceiptToken is ERC20, Ownable {
    address public vault;

    modifier onlyVault() {
        require(msg.sender == vault, "ReceiptToken: not vault");
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        address owner_
    ) ERC20(name_, symbol_) Ownable(owner_) {}

    /// @notice Shares are minted at the vault's 8-decimal USD scale ($1.00 = 1e8 at launch),
    ///         so wallets and explorers show whole shares.
    function decimals() public pure override returns (uint8) {
        return 8;
    }

    function setVault(address vault_) external onlyOwner {
        vault = vault_;
    }

    function mint(address to, uint256 amount) external onlyVault {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyVault {
        _burn(from, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        require(from == address(0) || to == address(0), "ReceiptToken: non-transferable");
        super._update(from, to, value);
    }
}
