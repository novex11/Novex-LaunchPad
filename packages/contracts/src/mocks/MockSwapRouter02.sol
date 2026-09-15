// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapRouter02} from "../interfaces/ISwapRouter02.sol";

/// @title MockSwapRouter02 — Uniswap SwapRouter02 `exactInput` stand-in for tests
/// @notice Fills each hop at a configurable rate (`setRate`), minus the hop's fee
///         tier, and records the last call so tests can assert the path used.
///         Pre-fund the router with output tokens before use.
contract MockSwapRouter02 is ISwapRouter02 {
    using SafeERC20 for IERC20;

    struct Rate {
        uint256 num;
        uint256 den;
    }

    /// @dev keccak256(tokenIn, tokenOut) → output per input (default 1:1)
    mapping(bytes32 => Rate) public rates;
    /// @dev Whether to revert like the real router when output < amountOutMinimum.
    bool public enforceMin = true;

    bytes public lastPath;
    address public lastRecipient;
    uint256 public lastAmountIn;
    uint256 public lastAmountOutMinimum;

    function setRate(address tokenIn, address tokenOut, uint256 num, uint256 den) external {
        rates[keccak256(abi.encodePacked(tokenIn, tokenOut))] = Rate(num, den);
    }

    function setEnforceMin(bool enforce) external {
        enforceMin = enforce;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut) {
        require(params.path.length >= 43 && (params.path.length - 20) % 23 == 0, "MockSwapRouter02: bad path");
        lastPath = params.path;
        lastRecipient = params.recipient;
        lastAmountIn = params.amountIn;
        lastAmountOutMinimum = params.amountOutMinimum;

        amountOut = params.amountIn;
        for (uint256 i; i + 20 < params.path.length; i += 23) {
            address hopIn = address(bytes20(params.path[i:i + 20]));
            uint24 fee = uint24(bytes3(params.path[i + 20:i + 23]));
            address hopOut = address(bytes20(params.path[i + 23:i + 43]));
            Rate memory r = rates[keccak256(abi.encodePacked(hopIn, hopOut))];
            if (r.den != 0) amountOut = (amountOut * r.num) / r.den;
            amountOut = (amountOut * (1_000_000 - fee)) / 1_000_000;
        }
        if (enforceMin) require(amountOut >= params.amountOutMinimum, "Too little received");

        address tokenIn = address(bytes20(params.path[:20]));
        address tokenOut = address(bytes20(params.path[params.path.length - 20:]));
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        IERC20(tokenOut).safeTransfer(params.recipient, amountOut);
    }
}
