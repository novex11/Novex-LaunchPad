// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {CreatorToken} from "./CreatorToken.sol";
import {PairFactory} from "./PairFactory.sol";
import {PairVault} from "./PairVault.sol";

/// @title ComposeCurve — creator tokens on a stock-backed bonding curve
/// @notice Every launched pair can carry exactly one 1B-supply token, issued by the
///         pair's creator and carrying the pair's own name and symbol. The whole supply
///         is minted to the curve (the creator receives nothing at launch; a dev buy is
///         an ordinary curve purchase capped at 5% of supply). Each token trades on a
///         constant-product curve quoted in the pair's share token, so every buy is
///         backed by real stocks in the vault. Every trade pays a 1% fee in shares,
///         70% to the creator and 30% to the protocol. The shape mirrors Pons: the
///         full supply sits on the curve against a virtual quote reserve worth
///         `startMarketCapUsd8`, and the token graduates once real shares paired
///         reach 3.0976x that reserve (Pons: 4.2 ETH over 1.3559 ETH), i.e. ~16.8x
///         the starting market cap. Trading continues on the curve after graduation.
contract ComposeCurve is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;
    uint16 public constant FEE_BPS = 100; // 1% of every trade, in shares
    /// @dev The pair creator is always the token creator, so one bucket: 70% creator, 30% protocol.
    uint16 public constant CREATOR_FEE_SHARE_BPS = 7_000;
    uint16 public constant GRADUATION_MULTIPLE_BPS = 30_976;
    uint16 public constant MAX_DEV_BUY_BPS = 500; // 5% of supply
    /// @dev Launch window: creator-only in the launch second, then capped buys.
    uint256 public constant SNIPE_WINDOW = 30;
    uint16 public constant SNIPE_MAX_TX_BPS = 550;
    uint16 public constant SNIPE_MAX_WALLET_BPS = 500;
    /// @dev Same limits as PairFactory, since the token inherits the pair's receipt name/symbol.
    uint256 public constant MAX_NAME_LENGTH = 64;
    uint256 public constant MAX_SYMBOL_LENGTH = 16;

    struct Curve {
        address pair;
        address share;
        address creator;
        /// Virtual quote reserve Q (shares); price = Q / tokenReserve.
        uint256 virtualQuote;
        /// Tokens still held by the curve.
        uint256 tokenReserve;
        /// Shares actually paid in (Q minus the starting virtual reserve).
        uint256 realQuote;
        uint256 graduationQuote;
        uint64 launchTime;
        bool graduated;
    }

    PairFactory public immutable factory;
    address public treasury;
    /// @notice Starting market cap for new tokens, USD with 8 decimals.
    uint256 public startMarketCapUsd8;

    mapping(address => Curve) public curves;
    /// @dev At most one entry per pair; kept as an array for ABI compatibility with `tokensOfPair`.
    mapping(address => address[]) internal _pairTokens;
    address[] public allTokens;
    /// @notice token => shares owed to its creator
    mapping(address => uint256) public creatorFees;
    /// @notice share token => shares owed to the protocol
    mapping(address => uint256) public protocolFees;

    event TokenCreated(
        address indexed token,
        address indexed pair,
        address indexed creator,
        address share,
        string name,
        string symbol,
        uint256 virtualQuote,
        uint256 graduationQuote
    );
    event Trade(
        address indexed token,
        address indexed trader,
        bool isBuy,
        uint256 shares,
        uint256 tokens,
        uint256 fee,
        uint256 virtualQuote,
        uint256 tokenReserve
    );
    event Graduated(address indexed token, uint256 realQuote, uint256 marketCapShares);
    event CreatorFeesClaimed(address indexed token, address indexed creator, uint256 shares);
    event ProtocolFeesWithdrawn(address indexed share, address indexed treasury, uint256 shares);
    event TreasurySet(address indexed treasury);
    event StartMarketCapSet(uint256 startMarketCapUsd8);

    constructor(address owner_, address factory_, address treasury_, uint256 startMarketCapUsd8_) Ownable(owner_) {
        require(factory_ != address(0) && treasury_ != address(0), "ComposeCurve: zero address");
        require(startMarketCapUsd8_ > 0, "ComposeCurve: zero start mcap");
        factory = PairFactory(factory_);
        treasury = treasury_;
        startMarketCapUsd8 = startMarketCapUsd8_;
    }

    // ─── Admin ──────────────────────────────────────────────

    function setTreasury(address treasury_) external onlyOwner {
        require(treasury_ != address(0), "ComposeCurve: zero address");
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    /// @notice Only affects tokens created afterwards.
    function setStartMarketCap(uint256 startMarketCapUsd8_) external onlyOwner {
        require(startMarketCapUsd8_ > 0, "ComposeCurve: zero start mcap");
        startMarketCapUsd8 = startMarketCapUsd8_;
        emit StartMarketCapSet(startMarketCapUsd8_);
    }

    function withdrawProtocolFees(address share) external onlyOwner {
        uint256 amount = protocolFees[share];
        require(amount > 0, "ComposeCurve: no fees");
        protocolFees[share] = 0;
        IERC20(share).safeTransfer(treasury, amount);
        emit ProtocolFeesWithdrawn(share, treasury, amount);
    }

    // ─── Launch ─────────────────────────────────────────────

    /// @notice Issue the pair's token. Only the pair creator may call, and only once per pair.
    ///         The token's ERC-20 name and symbol are copied from the pair's receipt token.
    /// @param devBuyShares Optional creator buy in the launch transaction (≤ 5% of supply)
    /// @param minDevTokens Slippage floor for the dev buy
    function createToken(address pair, uint256 devBuyShares, uint256 minDevTokens)
        external
        nonReentrant
        returns (address token, uint256 devTokens)
    {
        token = _launchToken(pair);
        if (devBuyShares > 0) {
            devTokens = _buy(token, msg.sender, devBuyShares, minDevTokens, msg.sender);
            require(devTokens <= (TOTAL_SUPPLY * MAX_DEV_BUY_BPS) / 10_000, "ComposeCurve: dev buy too large");
        }
    }

    function _launchToken(address pair) internal returns (address token) {
        require(factory.isPair(pair), "ComposeCurve: unknown pair");
        PairVault vault = PairVault(pair);
        require(msg.sender == vault.creator(), "ComposeCurve: only pair creator");
        require(_pairTokens[pair].length == 0, "ComposeCurve: pair already has a token");

        IERC20Metadata receipt = IERC20Metadata(address(vault.receiptToken()));
        string memory name = receipt.name();
        string memory symbol = receipt.symbol();
        _checkMetadata(name, symbol);
        uint256 q0 = _startQuote(vault);

        token = address(new CreatorToken(name, symbol, TOTAL_SUPPLY, address(this)));
        Curve storage c = curves[token];
        c.pair = pair;
        c.share = address(receipt);
        c.creator = msg.sender;
        c.virtualQuote = q0;
        c.tokenReserve = TOTAL_SUPPLY;
        c.graduationQuote = Math.mulDiv(q0, GRADUATION_MULTIPLE_BPS, 10_000);
        c.launchTime = uint64(block.timestamp);
        _pairTokens[pair].push(token);
        allTokens.push(token);
        emit TokenCreated(token, pair, msg.sender, address(receipt), name, symbol, q0, c.graduationQuote);
    }

    function _checkMetadata(string memory name, string memory symbol) internal pure {
        uint256 nameLen = bytes(name).length;
        uint256 symbolLen = bytes(symbol).length;
        require(nameLen > 0 && nameLen <= MAX_NAME_LENGTH, "ComposeCurve: invalid name");
        require(symbolLen > 0 && symbolLen <= MAX_SYMBOL_LENGTH, "ComposeCurve: invalid symbol");
    }

    /// @dev Virtual quote reserve (shares) worth `startMarketCapUsd8` at the pair's share price.
    function _startQuote(PairVault vault) internal view returns (uint256 q0) {
        require(vault.totalShares() > 0, "ComposeCurve: pair not seeded");
        uint256 sharePrice8 = vault.sharePrice();
        require(sharePrice8 > 0, "ComposeCurve: no share price");
        q0 = Math.mulDiv(startMarketCapUsd8, 1e18, sharePrice8);
        require(q0 > 0, "ComposeCurve: start mcap too small");
    }

    // ─── Trading ────────────────────────────────────────────

    /// @notice Buy tokens with `sharesIn` pair shares (1% fee included).
    function buy(address token, uint256 sharesIn, uint256 minTokensOut, address to)
        external
        nonReentrant
        returns (uint256 tokensOut)
    {
        require(to != address(0), "ComposeCurve: zero recipient");
        return _buy(token, msg.sender, sharesIn, minTokensOut, to);
    }

    /// @notice Sell `tokensIn` tokens for pair shares (1% fee deducted).
    function sell(address token, uint256 tokensIn, uint256 minSharesOut, address to)
        external
        nonReentrant
        returns (uint256 sharesOut)
    {
        require(to != address(0), "ComposeCurve: zero recipient");
        require(tokensIn > 0, "ComposeCurve: zero amount");
        Curve storage c = _curve(token);

        (uint256 out, uint256 fee, uint256 gross, uint256 newQuote) = _sellMath(c, tokensIn);
        require(out > 0 && out >= minSharesOut, "ComposeCurve: slippage");
        sharesOut = out;

        IERC20(token).safeTransferFrom(msg.sender, address(this), tokensIn);
        c.virtualQuote = newQuote;
        c.tokenReserve += tokensIn;
        c.realQuote -= gross;
        _accrueFees(token, c, fee);
        IERC20(c.share).safeTransfer(to, sharesOut);

        _emitTrade(token, to, false, sharesOut, tokensIn, fee);
    }

    function claimCreatorFees(address token) external nonReentrant returns (uint256 amount) {
        Curve storage c = _curve(token);
        amount = creatorFees[token];
        require(amount > 0, "ComposeCurve: no fees");
        creatorFees[token] = 0;
        IERC20(c.share).safeTransfer(c.creator, amount);
        emit CreatorFeesClaimed(token, c.creator, amount);
    }

    // ─── Views ──────────────────────────────────────────────

    function tokenCount() external view returns (uint256) {
        return allTokens.length;
    }

    function pairTokenCount(address pair) external view returns (uint256) {
        return _pairTokens[pair].length;
    }

    /// @notice Tokens launched on `pair` (at most one).
    function tokensOfPair(address pair) external view returns (address[] memory) {
        return _pairTokens[pair];
    }

    /// @notice The pair's token, or address(0) if its creator has not launched one yet.
    function tokenOfPair(address pair) external view returns (address) {
        address[] storage list = _pairTokens[pair];
        return list.length == 0 ? address(0) : list[0];
    }

    function quoteBuy(address token, uint256 sharesIn) external view returns (uint256 tokensOut, uint256 fee) {
        (tokensOut, fee, ) = _buyMath(_curve(token), sharesIn);
    }

    function quoteSell(address token, uint256 tokensIn) external view returns (uint256 sharesOut, uint256 fee) {
        (sharesOut, fee, , ) = _sellMath(_curve(token), tokensIn);
    }

    /// @notice Market cap in pair shares (price × total supply).
    function marketCapShares(address token) public view returns (uint256) {
        Curve storage c = _curve(token);
        return Math.mulDiv(c.virtualQuote, TOTAL_SUPPLY, c.tokenReserve);
    }

    /// @notice Market cap in USD (8 decimals) at the pair's current share price.
    function marketCapUsd8(address token) external view returns (uint256) {
        return Math.mulDiv(marketCapShares(token), PairVault(curves[token].pair).sharePrice(), 1e18);
    }

    /// @notice Progress toward graduation in basis points (capped at 10,000).
    function progressBps(address token) external view returns (uint256) {
        Curve storage c = _curve(token);
        if (c.realQuote >= c.graduationQuote) return 10_000;
        return (c.realQuote * 10_000) / c.graduationQuote;
    }

    // ─── Internals ──────────────────────────────────────────

    function _curve(address token) internal view returns (Curve storage c) {
        c = curves[token];
        require(c.share != address(0), "ComposeCurve: unknown token");
    }

    function _buyMath(Curve storage c, uint256 sharesIn)
        internal
        view
        returns (uint256 tokensOut, uint256 fee, uint256 newReserve)
    {
        fee = (sharesIn * FEE_BPS) / 10_000;
        // Round the new reserve up so k never decreases.
        newReserve = Math.mulDiv(
            c.virtualQuote,
            c.tokenReserve,
            c.virtualQuote + sharesIn - fee,
            Math.Rounding.Ceil
        );
        tokensOut = c.tokenReserve - newReserve;
    }

    function _sellMath(Curve storage c, uint256 tokensIn)
        internal
        view
        returns (uint256 sharesOut, uint256 fee, uint256 gross, uint256 newQuote)
    {
        newQuote = Math.mulDiv(c.virtualQuote, c.tokenReserve, c.tokenReserve + tokensIn, Math.Rounding.Ceil);
        gross = c.virtualQuote - newQuote;
        if (gross > c.realQuote) {
            gross = c.realQuote;
            newQuote = c.virtualQuote - gross;
        }
        fee = (gross * FEE_BPS) / 10_000;
        sharesOut = gross - fee;
    }

    function _buy(address token, address payer, uint256 sharesIn, uint256 minTokensOut, address to)
        internal
        returns (uint256 tokensOut)
    {
        require(sharesIn > 0, "ComposeCurve: zero amount");
        Curve storage c = _curve(token);

        (uint256 out, uint256 fee, uint256 newReserve) = _buyMath(c, sharesIn);
        require(out > 0 && out >= minTokensOut, "ComposeCurve: slippage");
        tokensOut = out;
        _checkLaunchWindow(c, token, to, tokensOut);

        IERC20(c.share).safeTransferFrom(payer, address(this), sharesIn);
        c.virtualQuote += sharesIn - fee;
        c.tokenReserve = newReserve;
        c.realQuote += sharesIn - fee;
        _accrueFees(token, c, fee);
        IERC20(token).safeTransfer(to, tokensOut);

        _emitTrade(token, to, true, sharesIn, tokensOut, fee);
        _maybeGraduate(token, c);
    }

    function _emitTrade(address token, address trader, bool isBuy, uint256 shares, uint256 tokens, uint256 fee)
        internal
    {
        Curve storage c = curves[token];
        emit Trade(token, trader, isBuy, shares, tokens, fee, c.virtualQuote, c.tokenReserve);
    }

    function _maybeGraduate(address token, Curve storage c) internal {
        if (c.graduated || c.realQuote < c.graduationQuote) return;
        c.graduated = true;
        emit Graduated(token, c.realQuote, marketCapShares(token));
    }

    function _checkLaunchWindow(Curve storage c, address token, address to, uint256 tokensOut) internal view {
        if (block.timestamp >= c.launchTime + SNIPE_WINDOW) return;
        if (block.timestamp == c.launchTime) {
            require(to == c.creator, "ComposeCurve: launch block is creator-only");
        }
        require(tokensOut <= (TOTAL_SUPPLY * SNIPE_MAX_TX_BPS) / 10_000, "ComposeCurve: max buy during launch");
        require(
            IERC20(token).balanceOf(to) + tokensOut <= (TOTAL_SUPPLY * SNIPE_MAX_WALLET_BPS) / 10_000,
            "ComposeCurve: max wallet during launch"
        );
    }

    function _accrueFees(address token, Curve storage c, uint256 fee) internal {
        if (fee == 0) return;
        uint256 toCreator = (fee * CREATOR_FEE_SHARE_BPS) / 10_000;
        creatorFees[token] += toCreator;
        protocolFees[c.share] += fee - toCreator;
    }
}
