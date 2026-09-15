// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title PairShareToken — transferable share token of a launchpad PairVault
/// @notice Same mint/burn surface as ReceiptToken, but freely transferable so
///         shares can be listed in a DEX pool and picked up by trading
///         terminals. Redemption through the vault keeps the market price
///         anchored to NAV.
contract PairShareToken is ERC20, Ownable {
    address public vault;

    modifier onlyVault() {
        require(msg.sender == vault, "PairShareToken: not vault");
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        address owner_
    ) ERC20(name_, symbol_) Ownable(owner_) {}

    /// @dev Set once by the factory right after the vault is deployed.
    function setVault(address vault_) external onlyOwner {
        require(vault == address(0), "PairShareToken: vault set");
        vault = vault_;
    }

    function mint(address to, uint256 amount) external onlyVault {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyVault {
        _burn(from, amount);
    }
}
