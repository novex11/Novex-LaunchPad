// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapRouter} from "./interfaces/ISwapRouter.sol";
import {EmergencyRegistry} from "./EmergencyRegistry.sol";
import {OracleAdapter} from "./OracleAdapter.sol";

/// @title ExecutionRouter — routes swaps with slippage and approved asset enforcement
/// @notice Every swap is floored at the oracle-implied output minus `maxSlippageBps`
///         (when an oracle is configured), so no caller can be sandwiched below the
///         protocol-wide tolerance regardless of the `minAmountOut` it passes.
contract ExecutionRouter is Ownable {
    using SafeERC20 for IERC20;

    ISwapRouter public swapRouter;
    EmergencyRegistry public emergency;
    OracleAdapter public oracle;
    mapping(address => bool) public approvedTokens;
    mapping(address => bool) public authorizedCallers;
    uint256 public maxSlippageBps = 50;

    event SwapExecuted(
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );
    event SwapRouterUpdated(address indexed swapRouter);
    event OracleUpdated(address indexed oracle);
    event MaxSlippageUpdated(uint256 bps);

    constructor(address owner_, address swapRouter_) Ownable(owner_) {
        swapRouter = ISwapRouter(swapRouter_);
    }

    function setEmergency(address emergency_) external onlyOwner {
        emergency = EmergencyRegistry(emergency_);
    }

    /// @notice Oracle used for the per-swap output floor. Zero disables the floor.
    function setOracle(address oracle_) external onlyOwner {
        oracle = OracleAdapter(oracle_);
        emit OracleUpdated(oracle_);
    }

    /// @notice Swap venue adapter (implements ISwapRouter). Lets the protocol migrate
    ///         venues (e.g. Uniswap V3 → Rialto) without redeploying vaults.
    function setSwapRouter(address swapRouter_) external onlyOwner {
        require(swapRouter_ != address(0), "ExecutionRouter: zero router");
        swapRouter = ISwapRouter(swapRouter_);
        emit SwapRouterUpdated(swapRouter_);
    }

    function setApprovedToken(address token, bool approved) external onlyOwner {
        approvedTokens[token] = approved;
    }

    function setAuthorizedCaller(address caller, bool authorized) external onlyOwner {
        authorizedCallers[caller] = authorized;
    }

    function setMaxSlippageBps(uint256 bps) external onlyOwner {
        require(bps <= 500, "ExecutionRouter: slippage too high");
        maxSlippageBps = bps;
        emit MaxSlippageUpdated(bps);
    }

    /// @notice Oracle-implied output for `amountIn` of `tokenIn` in `tokenOut` units.
    function oracleQuote(
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) public view returns (uint256 amountOut) {
        uint256 priceIn = oracle.getPrice(tokenIn);
        uint256 priceOut = oracle.getPrice(tokenOut);
        uint8 decIn = IERC20Metadata(tokenIn).decimals();
        uint8 decOut = IERC20Metadata(tokenOut).decimals();
        amountOut = (amountIn * priceIn * (10 ** decOut)) / (priceOut * (10 ** decIn));
    }

    /// @notice Minimum output the router will accept for a swap: the caller's
    ///         `minAmountOut` or the oracle floor, whichever is higher.
    function minOutFor(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut
    ) public view returns (uint256) {
        if (address(oracle) == address(0)) return minAmountOut;
        uint256 floor = (oracleQuote(tokenIn, tokenOut, amountIn) * (10_000 - maxSlippageBps)) / 10_000;
        return floor > minAmountOut ? floor : minAmountOut;
    }

    function executeSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minAmountOut,
        address recipient
    ) external returns (uint256 amountOut) {
        require(
            msg.sender == owner() || authorizedCallers[msg.sender],
            "ExecutionRouter: unauthorized"
        );
        if (address(emergency) != address(0)) {
            require(!emergency.swapsPaused(), "ExecutionRouter: swaps paused");
        }
        require(approvedTokens[tokenIn] && approvedTokens[tokenOut], "ExecutionRouter: unapproved");
        require(amountIn > 0, "ExecutionRouter: zero amount");

        uint256 floor = minOutFor(tokenIn, tokenOut, amountIn, minAmountOut);

        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(address(swapRouter), amountIn);
        uint256 balBefore = IERC20(tokenOut).balanceOf(recipient);
        amountOut = swapRouter.swap(
            ISwapRouter.SwapParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                amountIn: amountIn,
                minAmountOut: floor,
                recipient: recipient
            })
        );
        // Trust balances, not the venue's return value.
        uint256 received = IERC20(tokenOut).balanceOf(recipient) - balBefore;
        require(received >= floor, "ExecutionRouter: slippage");
        amountOut = received;
        emit SwapExecuted(tokenIn, tokenOut, amountIn, amountOut);
    }
}
