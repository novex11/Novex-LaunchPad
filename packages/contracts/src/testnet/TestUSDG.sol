// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title TestUSDG — TESTNET ONLY 6-decimal stand-in for Global Dollar (USDG)
/// @notice Robinhood Chain testnet has no USDG. Anyone can claim from the
///         faucet once per cooldown; the owner funds the testnet swap router.
contract TestUSDG is ERC20, Ownable {
    uint256 public constant FAUCET_AMOUNT = 1_000e6;
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    mapping(address => uint256) public lastFaucetAt;

    constructor(address owner_) ERC20("Test Global Dollar", "USDG") Ownable(owner_) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function faucet() external {
        require(
            lastFaucetAt[msg.sender] == 0 || block.timestamp >= lastFaucetAt[msg.sender] + FAUCET_COOLDOWN,
            "TestUSDG: cooldown"
        );
        lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }
}
