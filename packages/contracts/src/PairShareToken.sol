// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title PairShareToken — transferable share token of a launchpad PairVault
/// @notice Same mint/burn surface as ReceiptToken, but freely transferable so
///         shares can be listed in a DEX pool and picked up by trading
///         terminals. Redemption through the vault keeps the market price
///         anchored to NAV.
/// @dev Deployed as an EIP-1167 minimal proxy of one verified implementation
///      (see PairDeployer), so every launched share token is recognised by the
///      block explorer as verified the moment it exists. The name and symbol
///      therefore live in this contract's own storage instead of the ERC20
///      constructor, and `initialize` replaces the constructor for clones.
contract PairShareToken is ERC20, Ownable {
    address public vault;
    bool private _initialized;
    string private _tokenName;
    string private _tokenSymbol;

    modifier onlyVault() {
        require(msg.sender == vault, "PairShareToken: not vault");
        _;
    }

    /// @dev The implementation itself is locked: only clones can be initialized.
    constructor() ERC20("", "") Ownable(msg.sender) {
        _initialized = true;
    }

    /// @notice One-time setup of a clone, called by PairDeployer in the same transaction.
    function initialize(string calldata name_, string calldata symbol_, address owner_) external {
        require(!_initialized, "PairShareToken: initialized");
        _initialized = true;
        _tokenName = name_;
        _tokenSymbol = symbol_;
        _transferOwnership(owner_);
    }

    function name() public view override returns (string memory) {
        return _tokenName;
    }

    function symbol() public view override returns (string memory) {
        return _tokenSymbol;
    }

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
