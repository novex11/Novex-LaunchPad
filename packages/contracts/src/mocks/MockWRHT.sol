// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockWRHT — minimal WETH-shaped wrapper for the launchpad Zap tests
contract MockWRHT is ERC20 {
    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);

    constructor() ERC20("Wrapped RHT", "WRHT") {}

    function deposit() public payable {
        _mint(msg.sender, msg.value);
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 wad) external {
        _burn(msg.sender, wad);
        (bool ok, ) = msg.sender.call{value: wad}("");
        require(ok, "MockWRHT: withdraw failed");
        emit Withdrawal(msg.sender, wad);
    }

    /// @dev Test helper to mint arbitrary WRHT without needing to send ETH.
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    receive() external payable {
        deposit();
    }
}
