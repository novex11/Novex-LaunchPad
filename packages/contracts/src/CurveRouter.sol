// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ComposeCurve} from "./ComposeCurve.sol";
import {PairRouter} from "./PairRouter.sol";
import {PairVault} from "./PairVault.sol";

/// @title CurveRouter — buy and sell creator tokens with ETH, USDG or the pair's stocks
/// @notice Buy: ETH/USDG → PairRouter (swap into both stocks, mint pair shares)
///         → ComposeCurve. Sell: ComposeCurve → pair shares → PairRouter (redeem,
///         swap back) → ETH/USDG. `buyWithStocks` / `sellForStocks` skip the swap
///         and deposit or redeem the pair's two stocks directly (no DEX fee).
///         Holds nothing between transactions.
contract CurveRouter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    ComposeCurve public immutable curve;
    PairRouter public immutable pairRouter;
    address public immutable weth;
    address public immutable usdg;

    /// @param payToken  USDG or WETH; send `msg.value == amountIn` to pay in ETH
    struct BuyParams {
        address token;
        address payToken;
        uint256 amountIn;
        bytes pathA;
        bytes pathB;
        uint256 minTokensOut;
        uint16 maxSlippageBps;
        uint256 deadline;
    }

    struct SellParams {
        address token;
        uint256 tokensIn;
        address receiveToken;
        bytes pathA;
        bytes pathB;
        uint256 minAmountOut;
        uint16 maxSlippageBps;
        bool unwrapEth;
        uint256 deadline;
    }

    /// @dev `payToken` / `receiveToken` is address(0) for native ETH, and the pair
    ///      address when the trade was settled directly in the pair's two stocks.
    event TokenBought(address indexed token, address indexed user, address payToken, uint256 amountIn, uint256 tokensOut);
    event TokenSold(address indexed token, address indexed user, address receiveToken, uint256 tokensIn, uint256 amountOut);

    constructor(address curve_, address pairRouter_) {
        require(curve_ != address(0) && pairRouter_ != address(0), "CurveRouter: zero address");
        curve = ComposeCurve(curve_);
        pairRouter = PairRouter(payable(pairRouter_));
        weth = PairRouter(payable(pairRouter_)).weth();
        usdg = PairRouter(payable(pairRouter_)).usdg();
    }

    receive() external payable {
        require(msg.sender == address(pairRouter) || msg.sender == weth, "CurveRouter: unexpected ETH");
    }

    function buy(BuyParams calldata p) external payable nonReentrant returns (uint256 tokensOut) {
        (address pair, address share) = _curveOf(p.token);
        uint256 shares = _buyShares(p, pair);
        IERC20(share).forceApprove(address(curve), shares);
        tokensOut = curve.buy(p.token, shares, p.minTokensOut, msg.sender);
        _refundLeftovers(pair, share, p.payToken);
        emit TokenBought(p.token, msg.sender, msg.value > 0 ? address(0) : p.payToken, p.amountIn, tokensOut);
    }

    function sell(SellParams calldata p) external nonReentrant returns (uint256 amountOut) {
        (address pair, ) = _curveOf(p.token);
        require(p.tokensIn > 0, "CurveRouter: zero amount");

        IERC20(p.token).safeTransferFrom(msg.sender, address(this), p.tokensIn);
        IERC20(p.token).forceApprove(address(curve), p.tokensIn);
        uint256 shares = curve.sell(p.token, p.tokensIn, 0, address(this));
        amountOut = _sellShares(p, pair, shares);

        if (p.unwrapEth) {
            (bool ok, ) = msg.sender.call{value: amountOut}("");
            require(ok, "CurveRouter: ETH transfer failed");
        } else {
            IERC20(p.receiveToken).safeTransfer(msg.sender, amountOut);
        }
        emit TokenSold(p.token, msg.sender, p.unwrapEth ? address(0) : p.receiveToken, p.tokensIn, amountOut);
    }

    // ─── Stocks (no swap) ───────────────────────────────────

    /// @notice Buy `token` by depositing the pair's own stocks. Only the proportional
    ///         amounts (see PairVault.previewDeposit) are pulled from the caller.
    function buyWithStocks(address token, uint256 maxA, uint256 maxB, uint256 minTokensOut)
        external
        nonReentrant
        returns (uint256 tokensOut)
    {
        (address pair, address share) = _curveOf(token);
        require(maxA > 0 || maxB > 0, "CurveRouter: zero amount");
        PairVault vault = PairVault(pair);
        address tokenA = vault.tokenA();
        address tokenB = vault.tokenB();

        (, uint256 usedA, uint256 usedB) = vault.previewDeposit(maxA, maxB);
        if (usedA > 0) IERC20(tokenA).safeTransferFrom(msg.sender, address(this), usedA);
        if (usedB > 0) IERC20(tokenB).safeTransferFrom(msg.sender, address(this), usedB);
        IERC20(tokenA).forceApprove(address(vault), usedA);
        IERC20(tokenB).forceApprove(address(vault), usedB);
        uint256 shares = vault.depositFor(address(this), usedA, usedB, 0);
        IERC20(tokenA).forceApprove(address(vault), 0);
        IERC20(tokenB).forceApprove(address(vault), 0);

        IERC20(share).forceApprove(address(curve), shares);
        tokensOut = curve.buy(token, shares, minTokensOut, msg.sender);

        _refund(tokenA);
        _refund(tokenB);
        _refund(share);
        emit TokenBought(token, msg.sender, pair, usedA + usedB, tokensOut);
    }

    /// @notice Sell `tokensIn` of `token` and receive the pair's two stocks.
    function sellForStocks(address token, uint256 tokensIn, uint256 minAmountA, uint256 minAmountB)
        external
        nonReentrant
        returns (uint256 amountA, uint256 amountB)
    {
        (address pair, ) = _curveOf(token);
        require(tokensIn > 0, "CurveRouter: zero amount");
        PairVault vault = PairVault(pair);

        IERC20(token).safeTransferFrom(msg.sender, address(this), tokensIn);
        IERC20(token).forceApprove(address(curve), tokensIn);
        uint256 shares = curve.sell(token, tokensIn, 0, address(this));
        (amountA, amountB) = vault.redeem(shares, minAmountA, minAmountB);

        if (amountA > 0) IERC20(vault.tokenA()).safeTransfer(msg.sender, amountA);
        if (amountB > 0) IERC20(vault.tokenB()).safeTransfer(msg.sender, amountB);
        emit TokenSold(token, msg.sender, pair, tokensIn, amountA + amountB);
    }

    // ─── Internals ──────────────────────────────────────────

    /// @dev Pay ETH/USDG into PairRouter; pair shares are minted to this contract.
    function _buyShares(BuyParams calldata p, address pair) internal returns (uint256 shares) {
        if (msg.value == 0) {
            IERC20(p.payToken).safeTransferFrom(msg.sender, address(this), p.amountIn);
            IERC20(p.payToken).forceApprove(address(pairRouter), p.amountIn);
        }
        shares = pairRouter.buy{value: msg.value}(
            PairRouter.BuyParams({
                pair: pair,
                payToken: p.payToken,
                amountIn: p.amountIn,
                pathA: p.pathA,
                pathB: p.pathB,
                minShares: 0,
                maxSlippageBps: p.maxSlippageBps,
                deadline: p.deadline
            })
        );
        if (msg.value == 0) IERC20(p.payToken).forceApprove(address(pairRouter), 0);
    }

    /// @dev Redeem this contract's shares through PairRouter and swap to the payout asset.
    function _sellShares(SellParams calldata p, address pair, uint256 shares) internal returns (uint256) {
        // The vault is its own share token; PairRouter redeems through the
        // standard ERC-20 allowance.
        if (IERC20(pair).allowance(address(this), address(pairRouter)) < shares) {
            IERC20(pair).forceApprove(address(pairRouter), type(uint256).max);
        }
        return pairRouter.sell(
            PairRouter.SellParams({
                pair: pair,
                receiveToken: p.receiveToken,
                shares: shares,
                pathA: p.pathA,
                pathB: p.pathB,
                minAmountOut: p.minAmountOut,
                maxSlippageBps: p.maxSlippageBps,
                unwrapEth: p.unwrapEth,
                deadline: p.deadline
            })
        );
    }

    /// @dev PairRouter returns leftover stock dust and unused input to this contract.
    function _refundLeftovers(address pair, address share, address payToken) internal {
        PairVault vault = PairVault(pair);
        _refund(vault.tokenA());
        _refund(vault.tokenB());
        _refund(payToken);
        _refund(share);
        uint256 bal = address(this).balance;
        if (bal > 0) {
            (bool ok, ) = msg.sender.call{value: bal}("");
            require(ok, "CurveRouter: ETH refund failed");
        }
    }

    function _curveOf(address token) internal view returns (address pair, address share) {
        (pair, share, , , , , , , ) = curve.curves(token);
        require(share != address(0), "CurveRouter: unknown token");
    }

    function _refund(address token) internal {
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) IERC20(token).safeTransfer(msg.sender, bal);
    }
}
