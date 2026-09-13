// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IUniswapV3Router} from "./interfaces/IUniswapV3Router.sol";
import {IWRHT} from "./interfaces/IWRHT.sol";
import {PairVault} from "./PairVault.sol";

/// @title LaunchpadZap — one-tx source→USDG→pair seeder
/// @notice Public, unowned. Accepts USDG, either pair leg, WRHT, or native RHT
///         (via msg.value) as the seed source; converts anything non-USDG via
///         Uniswap v3, then calls `PairVault.depositFor(msg.sender, ...)` so
///         the receipt tokens mint straight to the end user.
/// @dev No admin, no upgrade path, no state. Immutable. Approve the Zap for
///      the ERC-20 source before calling `seedPair`; native RHT flows through
///      `msg.value` and skips the approve step entirely.
contract LaunchpadZap {
    using SafeERC20 for IERC20;

    IUniswapV3Router public immutable dex;
    IWRHT public immutable wrht;
    address public immutable usdg;

    /// @dev Fee tier for a stock leg -> USDG swap (0.3%)
    uint24 public constant FEE_STOCK_USDG = 3000;
    /// @dev Fee tier for WRHT -> USDG swap (0.05%)
    uint24 public constant FEE_RHT_USDG = 500;

    event Seeded(
        address indexed pair,
        address indexed user,
        address indexed sourceToken,
        uint256 sourceAmount,
        uint256 usdgOut,
        uint256 sharesMinted
    );

    constructor(address dex_, address wrht_, address usdg_) {
        require(dex_ != address(0), "Zap: zero dex");
        require(wrht_ != address(0), "Zap: zero wrht");
        require(usdg_ != address(0), "Zap: zero usdg");
        dex = IUniswapV3Router(dex_);
        wrht = IWRHT(wrht_);
        usdg = usdg_;
    }

    /// @notice Seed an existing pair with any supported source.
    /// @param pair          PairVault address (already launched)
    /// @param sourceToken   USDG, a pair leg, WRHT, or address(0) for native RHT
    /// @param sourceAmount  Ignored when sourceToken == address(0) (uses msg.value)
    /// @param minShares     Slippage guard on the final pair.depositFor
    function seedPair(
        address pair,
        address sourceToken,
        uint256 sourceAmount,
        uint256 minShares
    ) external payable returns (uint256 sharesMinted) {
        require(pair != address(0), "Zap: zero pair");

        // 1. Normalize native RHT -> WRHT (owned by this contract)
        address effectiveSource = sourceToken;
        uint256 effectiveAmount = sourceAmount;
        if (sourceToken == address(0)) {
            require(msg.value > 0, "Zap: no value");
            wrht.deposit{value: msg.value}();
            effectiveSource = address(wrht);
            effectiveAmount = msg.value;
        } else {
            require(msg.value == 0, "Zap: unexpected value");
            require(sourceAmount > 0, "Zap: zero amount");
            IERC20(sourceToken).safeTransferFrom(
                msg.sender,
                address(this),
                sourceAmount
            );
        }

        // 2. Convert to USDG if needed
        uint256 usdgAmount;
        if (effectiveSource == usdg) {
            usdgAmount = effectiveAmount;
        } else {
            usdgAmount = _swapToUsdg(effectiveSource, effectiveAmount);
        }

        // 3. Deposit USDG on behalf of the user (mints receipt to msg.sender)
        IERC20(usdg).forceApprove(pair, usdgAmount);
        sharesMinted = PairVault(pair).depositFor(
            msg.sender,
            usdgAmount,
            minShares
        );

        emit Seeded(
            pair,
            msg.sender,
            sourceToken,
            sourceToken == address(0) ? msg.value : sourceAmount,
            usdgAmount,
            sharesMinted
        );
    }

    function _swapToUsdg(address tokenIn, uint256 amountIn)
        internal
        returns (uint256 amountOut)
    {
        uint24 fee = tokenIn == address(wrht) ? FEE_RHT_USDG : FEE_STOCK_USDG;
        IERC20(tokenIn).forceApprove(address(dex), amountIn);
        amountOut = dex.exactInputSingle(
            IUniswapV3Router.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: usdg,
                fee: fee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: 0, // slippage rides on minShares at the pair
                sqrtPriceLimitX96: 0
            })
        );
    }

    /// @notice Convenience view: returns true if `sourceToken` is the sentinel
    ///         for native RHT (address(0)). The frontend uses this to decide
    ///         whether to send `msg.value` instead of ERC-20 approve+pull.
    function isNative(address sourceToken) external pure returns (bool) {
        return sourceToken == address(0);
    }
}
