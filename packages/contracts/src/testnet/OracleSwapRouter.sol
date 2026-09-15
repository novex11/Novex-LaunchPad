// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {OracleAdapter} from "../OracleAdapter.sol";
import {ISwapRouter02} from "../interfaces/ISwapRouter02.sol";

/// @title OracleSwapRouter — TESTNET ONLY stand-in for Uniswap SwapRouter02
/// @notice Robinhood Chain testnet has no Uniswap pools. This router fills
///         `exactInput` at oracle prices minus each hop's fee tier, paying out of
///         inventory the owner funds. Same interface as SwapRouter02, so
///         PairRouter runs unchanged against real Uniswap on mainnet.
contract OracleSwapRouter is ISwapRouter02, Ownable {
    using SafeERC20 for IERC20;

    OracleAdapter public immutable oracle;

    event Swapped(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address recipient
    );

    constructor(address owner_, address oracle_) Ownable(owner_) {
        oracle = OracleAdapter(oracle_);
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut) {
        require(msg.value == 0, "OracleSwapRouter: no ETH");
        amountOut = _quote(params.path, params.amountIn);
        require(amountOut >= params.amountOutMinimum, "OracleSwapRouter: too little received");

        address tokenIn = address(bytes20(params.path[:20]));
        address tokenOut = address(bytes20(params.path[params.path.length - 20:]));
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        IERC20(tokenOut).safeTransfer(params.recipient, amountOut);

        emit Swapped(tokenIn, tokenOut, params.amountIn, amountOut, params.recipient);
    }

    /// @notice Output `exactInput` would return right now.
    function quoteExactInput(bytes calldata path, uint256 amountIn) external view returns (uint256) {
        return _quote(path, amountIn);
    }

    /// @notice Recover inventory.
    function withdraw(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    function _quote(bytes calldata path, uint256 amountIn) internal view returns (uint256 amount) {
        require(path.length >= 43 && (path.length - 20) % 23 == 0, "OracleSwapRouter: bad path");
        amount = amountIn;
        for (uint256 i; i + 20 < path.length; i += 23) {
            address hopIn = address(bytes20(path[i:i + 20]));
            uint24 fee = uint24(bytes3(path[i + 20:i + 23]));
            address hopOut = address(bytes20(path[i + 23:i + 43]));
            require(fee < 1_000_000, "OracleSwapRouter: bad fee");

            uint256 valueUsd8 = Math.mulDiv(amount, oracle.getPrice(hopIn), 10 ** IERC20Metadata(hopIn).decimals());
            amount = Math.mulDiv(valueUsd8, 10 ** IERC20Metadata(hopOut).decimals(), oracle.getPrice(hopOut));
            amount = Math.mulDiv(amount, 1_000_000 - fee, 1_000_000);
        }
    }
}
