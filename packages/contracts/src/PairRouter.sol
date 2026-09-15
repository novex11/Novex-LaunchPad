// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PairFactory} from "./PairFactory.sol";
import {PairVault} from "./PairVault.sol";
import {OracleAdapter} from "./OracleAdapter.sol";
import {ISwapRouter02} from "./interfaces/ISwapRouter02.sol";
import {IWETH} from "./interfaces/IWETH.sol";

/// @title PairRouter — buy and sell launchpad pairs with USDG or ETH
/// @notice Buying swaps the payment into both stock legs and deposits them for
///         the buyer. Pair vaults only accept deposits for their creator or a
///         factory-approved fee-exempt recipient (CurveRouter), so `buy` is a
///         creator top-up tool and the CurveRouter's inner leg; the public buys
///         the pair's curve token instead. Selling redeems the seller's shares
///         (the router must be their operator on that pair) and swaps both legs
///         back to USDG or ETH — open to any share holder.
///         Every swap is floored at the oracle price minus `maxSlippageBps`, so
///         a thin or manipulated pool can never fill far from fair value.
/// @dev No owner, no upgrades, holds nothing between transactions.
contract PairRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_SLIPPAGE_BPS = 300;

    PairFactory public immutable factory;
    OracleAdapter public immutable oracle;
    ISwapRouter02 public immutable swapRouter;
    address public immutable weth;
    address public immutable usdg;

    /// @param payToken  USDG or WETH; send `msg.value == amountIn` to pay in ETH
    /// @param pathA     Uniswap v3 path payToken -> tokenA (ignored if tokenA == payToken)
    struct BuyParams {
        address pair;
        address payToken;
        uint256 amountIn;
        bytes pathA;
        bytes pathB;
        uint256 minShares;
        uint16 maxSlippageBps;
        uint256 deadline;
    }

    /// @param receiveToken  USDG or WETH
    /// @param pathA         Uniswap v3 path tokenA -> receiveToken (ignored if equal)
    /// @param unwrapEth     Pay out native ETH (requires receiveToken == WETH)
    struct SellParams {
        address pair;
        address receiveToken;
        uint256 shares;
        bytes pathA;
        bytes pathB;
        uint256 minAmountOut;
        uint16 maxSlippageBps;
        bool unwrapEth;
        uint256 deadline;
    }

    /// @dev `payToken` / `receiveToken` is address(0) for native ETH.
    event Bought(address indexed pair, address indexed user, address indexed payToken, uint256 amountIn, uint256 shares);
    event Sold(address indexed pair, address indexed user, address indexed receiveToken, uint256 shares, uint256 amountOut);

    constructor(address factory_, address swapRouter_, address usdg_) {
        require(
            factory_ != address(0) && swapRouter_ != address(0) && usdg_ != address(0),
            "PairRouter: zero address"
        );
        factory = PairFactory(factory_);
        oracle = PairFactory(factory_).oracle();
        weth = PairFactory(factory_).weth();
        swapRouter = ISwapRouter02(swapRouter_);
        usdg = usdg_;
    }

    receive() external payable {
        require(msg.sender == weth, "PairRouter: ETH only from WETH");
    }

    // ─── Buy ────────────────────────────────────────────────

    function buy(BuyParams calldata p) external payable nonReentrant returns (uint256 shares) {
        PairVault vault = _checkPair(p.pair, p.maxSlippageBps, p.deadline);
        _checkQuoteToken(p.payToken);
        require(p.amountIn > 0, "PairRouter: zero amount");

        bool paidEth = msg.value > 0;
        if (paidEth) {
            require(p.payToken == weth && msg.value == p.amountIn, "PairRouter: ETH amount mismatch");
            IWETH(weth).deposit{value: msg.value}();
        } else {
            IERC20(p.payToken).safeTransferFrom(msg.sender, address(this), p.amountIn);
        }

        address tokenA = vault.tokenA();
        address tokenB = vault.tokenB();
        uint256 inForA = _splitForA(vault, tokenA, tokenB, p.amountIn);
        uint256 outA = _convert(p.payToken, tokenA, inForA, p.pathA, p.maxSlippageBps);
        uint256 outB = _convert(p.payToken, tokenB, p.amountIn - inForA, p.pathB, p.maxSlippageBps);

        IERC20(tokenA).forceApprove(address(vault), outA);
        IERC20(tokenB).forceApprove(address(vault), outB);
        shares = vault.depositFor(msg.sender, outA, outB, p.minShares);
        IERC20(tokenA).forceApprove(address(vault), 0);
        IERC20(tokenB).forceApprove(address(vault), 0);

        // Proportional deposits leave dust on one leg; return it with any unused input.
        _refund(tokenA, paidEth);
        _refund(tokenB, paidEth);
        _refund(p.payToken, paidEth);

        emit Bought(p.pair, msg.sender, paidEth ? address(0) : p.payToken, p.amountIn, shares);
    }

    // ─── Sell ───────────────────────────────────────────────

    function sell(SellParams calldata p) external nonReentrant returns (uint256 amountOut) {
        PairVault vault = _checkPair(p.pair, p.maxSlippageBps, p.deadline);
        _checkQuoteToken(p.receiveToken);
        require(!p.unwrapEth || p.receiveToken == weth, "PairRouter: unwrap needs WETH");

        (uint256 amountA, uint256 amountB) = vault.redeemFrom(msg.sender, p.shares, 0, 0, address(this));
        amountOut =
            _convert(vault.tokenA(), p.receiveToken, amountA, p.pathA, p.maxSlippageBps) +
            _convert(vault.tokenB(), p.receiveToken, amountB, p.pathB, p.maxSlippageBps);
        require(amountOut >= p.minAmountOut, "PairRouter: slippage");

        if (p.unwrapEth) {
            IWETH(weth).withdraw(amountOut);
            (bool ok, ) = msg.sender.call{value: amountOut}("");
            require(ok, "PairRouter: ETH transfer failed");
        } else {
            IERC20(p.receiveToken).safeTransfer(msg.sender, amountOut);
        }

        emit Sold(p.pair, msg.sender, p.unwrapEth ? address(0) : p.receiveToken, p.shares, amountOut);
    }

    // ─── Internals ──────────────────────────────────────────

    function _checkPair(address pair, uint16 slippageBps, uint256 deadline) internal view returns (PairVault vault) {
        require(block.timestamp <= deadline, "PairRouter: expired");
        require(slippageBps <= MAX_SLIPPAGE_BPS, "PairRouter: slippage too high");
        require(factory.isPair(pair), "PairRouter: unknown pair");
        vault = PairVault(pair);
        require(
            !oracle.isMultiplierPending(vault.tokenA()) && !oracle.isMultiplierPending(vault.tokenB()),
            "PairRouter: corporate action pending"
        );
    }

    function _checkQuoteToken(address token) internal view {
        require(token == usdg || (token == weth && weth != address(0)), "PairRouter: unsupported token");
    }

    /// @dev Share of `amountIn` that goes to tokenA, matching the vault's reserve value split.
    function _splitForA(PairVault vault, address tokenA, address tokenB, uint256 amountIn)
        internal
        view
        returns (uint256)
    {
        (uint256 balA, uint256 balB) = vault.reserves();
        require(balA > 0 && balB > 0, "PairRouter: pair not seeded");
        uint256 valueA = _valueUsd8(tokenA, balA);
        uint256 valueB = _valueUsd8(tokenB, balB);
        return Math.mulDiv(amountIn, valueA, valueA + valueB);
    }

    /// @dev Swap `amountIn` of `tokenIn` to `tokenOut` along `path`, floored at the oracle price.
    function _convert(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        bytes calldata path,
        uint16 slippageBps
    ) internal returns (uint256 amountOut) {
        if (amountIn == 0 || tokenIn == tokenOut) return amountIn;
        _checkPath(path, tokenIn, tokenOut);

        uint256 minOut = Math.mulDiv(_fairOut(tokenIn, tokenOut, amountIn), 10_000 - slippageBps, 10_000);
        uint256 before = IERC20(tokenOut).balanceOf(address(this));

        IERC20(tokenIn).forceApprove(address(swapRouter), amountIn);
        swapRouter.exactInput(
            ISwapRouter02.ExactInputParams({
                path: path,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: minOut
            })
        );
        IERC20(tokenIn).forceApprove(address(swapRouter), 0);

        amountOut = IERC20(tokenOut).balanceOf(address(this)) - before;
        require(amountOut >= minOut, "PairRouter: below oracle floor");
    }

    function _checkPath(bytes calldata path, address tokenIn, address tokenOut) internal pure {
        require(path.length >= 43 && (path.length - 20) % 23 == 0, "PairRouter: bad path");
        require(address(bytes20(path[:20])) == tokenIn, "PairRouter: path start");
        require(address(bytes20(path[path.length - 20:])) == tokenOut, "PairRouter: path end");
    }

    function _fairOut(address tokenIn, address tokenOut, uint256 amountIn) internal view returns (uint256) {
        return Math.mulDiv(
            _valueUsd8(tokenIn, amountIn),
            10 ** IERC20Metadata(tokenOut).decimals(),
            oracle.getPrice(tokenOut)
        );
    }

    function _valueUsd8(address token, uint256 amount) internal view returns (uint256) {
        return Math.mulDiv(amount, oracle.getPrice(token), 10 ** IERC20Metadata(token).decimals());
    }

    function _refund(address token, bool asEth) internal {
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal == 0) return;
        if (asEth && token == weth) {
            IWETH(weth).withdraw(bal);
            (bool ok, ) = msg.sender.call{value: bal}("");
            require(ok, "PairRouter: ETH refund failed");
        } else {
            IERC20(token).safeTransfer(msg.sender, bal);
        }
    }
}
