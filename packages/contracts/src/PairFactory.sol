// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PairShareToken} from "./PairShareToken.sol";
import {PoolKey, IV4PositionManager, IPermit2, V4Actions} from "./interfaces/IUniswapV4.sol";
import {PairVault} from "./PairVault.sol";
import {PairDeployer} from "./PairDeployer.sol";
import {OracleAdapter} from "./OracleAdapter.sol";
import {EmergencyRegistry} from "./EmergencyRegistry.sol";
import {IWETH} from "./interfaces/IWETH.sol";

/// @title PairFactory — permissionless launcher for two-token pair vaults
/// @notice Any wallet can pair any two tokens the owner has listed. A launch
///         deploys the vault and seeds it with the creator's tokens in the same
///         transaction. Uniqueness is enforced on the sorted (tokenA, tokenB).
contract PairFactory is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant MIN_WEIGHT_BPS = 1_000; // 10%
    uint16 public constant MAX_WEIGHT_BPS = 9_000; // 90%
    uint16 public constant MIN_CREATOR_FEE_BPS = 0; // deposits are creator-only, so 0 is the norm
    uint16 public constant MAX_CREATOR_FEE_BPS = 500; // 5%
    uint16 public constant MAX_PAIRS_PER_CREATOR = 10;
    uint256 public constant MAX_NAME_LENGTH = 64;
    uint256 public constant MAX_SYMBOL_LENGTH = 16;

    /// @dev Uniswap v4 pool: 0.30% fee, tick spacing 60, no hook, full range.
    uint24 public constant POOL_FEE = 3_000;
    int24 public constant POOL_TICK_SPACING = 60;
    int24 public constant POOL_TICK_LOWER = -887_220;
    int24 public constant POOL_TICK_UPPER = 887_220;
    /// @dev TickMath.getSqrtPriceAtTick(±887220) — the usable full range for spacing 60.
    uint160 internal constant SQRT_PRICE_LOWER = 4_306_310_044;
    uint160 internal constant SQRT_PRICE_UPPER = 1_457_652_066_949_847_389_969_617_340_386_294_118_487_833_376_468;
    uint256 internal constant Q96 = 2 ** 96;
    /// @dev At most half of the seed shares can be moved into the pool.
    uint16 public constant MAX_POOL_SHARE_BPS = 5_000;

    OracleAdapter public immutable oracle;
    EmergencyRegistry public immutable emergency;
    address public immutable weth;
    /// @notice Deploys each pair's vault + share token (keeps this contract under 24KB).
    PairDeployer public immutable pairDeployer;

    /// @notice Uniswap v4 PositionManager used to seed share/quote pools (0 = disabled).
    IV4PositionManager public positionManager;
    /// @notice Permit2 the PositionManager pulls funds through.
    IPermit2 public permit2;
    /// @notice Quote asset every pool is priced in (USDG on mainnet).
    address public poolQuoteToken;
    /// @notice pair => Uniswap v4 PoolId seeded at launch (0 if launched without a pool).
    mapping(address => bytes32) public poolIdOf;
    /// @notice pair => the pool's key (currencies, fee, tick spacing, hook).
    mapping(address => PoolKey) public poolKeyOf;
    /// @notice pair => LP position id held by the creator.
    mapping(address => uint256) public poolPositionOf;

    struct PairInfo {
        address pair;
        address receiptToken;
        address tokenA;
        address tokenB;
        uint16 weightABps;
        uint16 creatorFeeBps;
        address creator;
    }

    /// @param tokenA        Either token; order does not matter
    /// @param weightABps    Target value share of `tokenA`
    /// @param amountA       Seed amount of `tokenA` (for a WETH leg, send the same wei as msg.value to pay in ETH)
    /// @param minShares     Slippage guard on the creator's seed shares
    struct LaunchParams {
        address tokenA;
        address tokenB;
        uint16 weightABps;
        uint16 creatorFeeBps;
        string receiptName;
        string receiptSymbol;
        uint256 amountA;
        uint256 amountB;
        uint256 minShares;
    }

    /// @param poolShareBps    Share of the creator's seed shares moved into the DEX pool
    /// @param maxQuoteAmount  Cap on the quote tokens pulled to pair with those shares
    struct PoolParams {
        uint16 poolShareBps;
        uint256 maxQuoteAmount;
    }

    mapping(address => bool) public isListed;
    address[] private _knownTokens;
    mapping(address => bool) private _known;

    PairInfo[] public pairs;
    mapping(bytes32 => address) public pairByKey;
    mapping(address => uint256) public pairsCreatedBy;
    mapping(address => bool) public isPair;
    /// @notice Share recipients whose deposits skip the creator fee on every pair
    ///         (e.g. CurveRouter, so token buys are not charged twice).
    mapping(address => bool) public feeExemptRecipients;

    event PairLaunched(
        address indexed pair,
        address indexed receiptToken,
        address indexed creator,
        address tokenA,
        address tokenB,
        uint16 weightABps,
        uint16 creatorFeeBps
    );
    event TokenListed(address indexed token, bool listed);
    event FeeExemptSet(address indexed recipient, bool exempt);
    event PoolConfigSet(address indexed positionManager, address indexed permit2, address indexed quoteToken);
    event PoolSeeded(
        address indexed pair,
        bytes32 indexed poolId,
        address indexed creator,
        uint256 positionId,
        uint256 shares,
        uint256 quoteAmount
    );

    constructor(address owner_, address oracle_, address emergency_, address weth_, address pairDeployer_)
        Ownable(owner_)
    {
        require(pairDeployer_ != address(0), "PairFactory: zero deployer");
        oracle = OracleAdapter(oracle_);
        emergency = EmergencyRegistry(emergency_);
        weth = weth_;
        pairDeployer = PairDeployer(pairDeployer_);
    }

    // ─── Token listing ──────────────────────────────────────

    function setTokenListed(address token, bool listed) external onlyOwner {
        require(token != address(0), "PairFactory: zero token");
        if (listed) {
            require(oracle.hasFeed(token), "PairFactory: no price feed");
        }
        isListed[token] = listed;
        if (!_known[token]) {
            _known[token] = true;
            _knownTokens.push(token);
        }
        emit TokenListed(token, listed);
    }

    // ─── DEX pool config ────────────────────────────────────

    /// @notice Enable (or disable with zeros) seeding a Uniswap v4 share/quote
    ///         pool at launch. The quote token must have a price feed.
    function setPoolConfig(address positionManager_, address permit2_, address quoteToken_) external onlyOwner {
        bool off = positionManager_ == address(0);
        require(off == (permit2_ == address(0)) && off == (quoteToken_ == address(0)), "PairFactory: pool config");
        if (!off) {
            require(oracle.hasFeed(quoteToken_), "PairFactory: no quote feed");
        }
        positionManager = IV4PositionManager(positionManager_);
        permit2 = IPermit2(permit2_);
        poolQuoteToken = quoteToken_;
        emit PoolConfigSet(positionManager_, permit2_, quoteToken_);
    }

    function poolEnabled() public view returns (bool) {
        return address(positionManager) != address(0);
    }

    /// @notice Waive the pair creator fee for deposits whose shares go to `recipient`.
    function setFeeExempt(address recipient, bool exempt) external onlyOwner {
        require(recipient != address(0), "PairFactory: zero recipient");
        feeExemptRecipients[recipient] = exempt;
        emit FeeExemptSet(recipient, exempt);
    }

    function listedTokens() external view returns (address[] memory out) {
        uint256 n;
        for (uint256 i; i < _knownTokens.length; ++i) {
            if (isListed[_knownTokens[i]]) ++n;
        }
        out = new address[](n);
        uint256 j;
        for (uint256 i; i < _knownTokens.length; ++i) {
            if (isListed[_knownTokens[i]]) out[j++] = _knownTokens[i];
        }
    }

    // ─── Views ──────────────────────────────────────────────

    function pairCount() external view returns (uint256) {
        return pairs.length;
    }

    function computePairKey(address tokenA, address tokenB) public pure returns (bytes32) {
        (address lo, address hi) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encode(lo, hi));
    }

    function getPair(address tokenA, address tokenB)
        external
        view
        returns (address pair, address receiptToken)
    {
        pair = pairByKey[computePairKey(tokenA, tokenB)];
        require(pair != address(0), "PairFactory: not found");
        receiptToken = address(PairVault(pair).receiptToken());
    }

    // ─── Launch ─────────────────────────────────────────────

    function launchPair(LaunchParams calldata p)
        external
        payable
        nonReentrant
        returns (address pair, address receipt, uint256 shares)
    {
        return _launch(p, msg.sender);
    }

    /// @notice Launch and, in the same transaction, open a Uniswap v4 pool of
    ///         the share token against `poolQuoteToken`, seeded with
    ///         `poolShareBps` of the creator's shares plus quote tokens worth
    ///         the same at NAV. The LP position NFT goes to the creator.
    function launchPairWithPool(LaunchParams calldata p, PoolParams calldata q)
        external
        payable
        nonReentrant
        returns (address pair, address receipt, uint256 shares, bytes32 poolId)
    {
        require(poolEnabled(), "PairFactory: pool disabled");
        require(q.poolShareBps > 0 && q.poolShareBps <= MAX_POOL_SHARE_BPS, "PairFactory: invalid pool share");
        (pair, receipt, shares) = _launch(p, address(this));
        uint256 lpShares = (shares * q.poolShareBps) / 10_000;
        poolId = _bootstrapPool(pair, receipt, lpShares, q.maxQuoteAmount);
        IERC20(receipt).safeTransfer(msg.sender, shares - lpShares);
    }

    function _launch(LaunchParams calldata p, address recipient)
        internal
        returns (address pair, address receipt, uint256 shares)
    {
        _validate(p);
        bytes32 key = computePairKey(p.tokenA, p.tokenB);
        require(pairByKey[key] == address(0), "PairFactory: exists");

        (pair, receipt) = _deploy(p);
        pairByKey[key] = pair;
        isPair[pair] = true;
        pairsCreatedBy[msg.sender] += 1;

        shares = _seed(p, pair, recipient);
    }

    function _validate(LaunchParams calldata p) internal view {
        require(p.tokenA != address(0) && p.tokenB != address(0), "PairFactory: zero token");
        require(p.tokenA != p.tokenB, "PairFactory: identical tokens");
        require(isListed[p.tokenA] && isListed[p.tokenB], "PairFactory: unlisted token");
        require(
            p.weightABps >= MIN_WEIGHT_BPS && p.weightABps <= MAX_WEIGHT_BPS,
            "PairFactory: invalid weight"
        );
        require(
            p.creatorFeeBps >= MIN_CREATOR_FEE_BPS && p.creatorFeeBps <= MAX_CREATOR_FEE_BPS,
            "PairFactory: invalid fee"
        );
        uint256 nameLen = bytes(p.receiptName).length;
        uint256 symbolLen = bytes(p.receiptSymbol).length;
        require(nameLen > 0 && nameLen <= MAX_NAME_LENGTH, "PairFactory: invalid name");
        require(symbolLen > 0 && symbolLen <= MAX_SYMBOL_LENGTH, "PairFactory: invalid symbol");
        require(pairsCreatedBy[msg.sender] < MAX_PAIRS_PER_CREATOR, "PairFactory: creator cap");
        if (msg.value > 0) {
            require(
                weth != address(0) && (p.tokenA == weth || p.tokenB == weth),
                "PairFactory: ETH not accepted"
            );
        }
    }

    function _deploy(LaunchParams calldata p) internal returns (address pair, address receipt) {
        bool ordered = p.tokenA < p.tokenB;
        address lo = ordered ? p.tokenA : p.tokenB;
        address hi = ordered ? p.tokenB : p.tokenA;
        uint16 weightLo = ordered ? p.weightABps : uint16(10_000 - p.weightABps);

        (pair, receipt) = pairDeployer.deploy(
            PairVault.Config({
                creator: msg.sender,
                tokenA: lo,
                tokenB: hi,
                weightABps: weightLo,
                creatorFeeBps: p.creatorFeeBps,
                receiptToken: address(0), // set by the deployer
                oracle: address(oracle),
                emergency: address(emergency),
                weth: weth,
                factory: address(this)
            }),
            p.receiptName,
            p.receiptSymbol
        );
        PairShareToken(receipt).setVault(pair);

        pairs.push(
            PairInfo({
                pair: pair,
                receiptToken: receipt,
                tokenA: lo,
                tokenB: hi,
                weightABps: weightLo,
                creatorFeeBps: p.creatorFeeBps,
                creator: msg.sender
            })
        );

        emit PairLaunched(pair, receipt, msg.sender, lo, hi, weightLo, p.creatorFeeBps);
    }

    function _seed(LaunchParams calldata p, address pair, address recipient) internal returns (uint256 shares) {
        PairVault vault = PairVault(pair);
        address lo = vault.tokenA();
        address hi = vault.tokenB();
        uint256 amountLo = lo == p.tokenA ? p.amountA : p.amountB;
        uint256 amountHi = lo == p.tokenA ? p.amountB : p.amountA;

        uint256 nativeUsed = _collect(lo, amountLo, pair) + _collect(hi, amountHi, pair);
        require(msg.value == nativeUsed, "PairFactory: ETH amount mismatch");

        shares = vault.depositFor(recipient, amountLo, amountHi, p.minShares);
    }

    /// @dev Moves the creator's seed into the factory and approves the vault.
    function _collect(address token, uint256 amount, address pair) internal returns (uint256 nativeUsed) {
        if (token == weth && msg.value > 0) {
            IWETH(weth).deposit{value: amount}();
            nativeUsed = amount;
        } else {
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        }
        IERC20(token).forceApprove(pair, amount);
    }

    // ─── DEX pool bootstrap (Uniswap v4) ────────────────────

    /// @dev Prices `lpShares` at the vault's NAV, pulls the matching quote
    ///      amount from the creator, initializes the v4 pool at that price and
    ///      mints a full-range position to the creator.
    function _bootstrapPool(address pair, address share, uint256 lpShares, uint256 maxQuoteAmount)
        internal
        returns (bytes32 poolId)
    {
        require(lpShares > 0, "PairFactory: zero pool shares");
        uint256 quoteAmount = _quoteForShares(pair, lpShares);
        require(quoteAmount > 0 && quoteAmount <= maxQuoteAmount, "PairFactory: quote amount");
        IERC20(poolQuoteToken).safeTransferFrom(msg.sender, address(this), quoteAmount);

        PoolKey memory key;
        uint256 a0;
        uint256 a1;
        if (share < poolQuoteToken) {
            (key.currency0, key.currency1, a0, a1) = (share, poolQuoteToken, lpShares, quoteAmount);
        } else {
            (key.currency0, key.currency1, a0, a1) = (poolQuoteToken, share, quoteAmount, lpShares);
        }
        key.fee = POOL_FEE;
        key.tickSpacing = POOL_TICK_SPACING;

        uint256 positionId = _mintFullRange(key, a0, a1);
        poolId = keccak256(abi.encode(key));
        poolIdOf[pair] = poolId;
        poolKeyOf[pair] = key;
        poolPositionOf[pair] = positionId;
        emit PoolSeeded(pair, poolId, msg.sender, positionId, lpShares, quoteAmount);
    }

    /// @dev Quote tokens worth `lpShares` at the vault's NAV (fresh quote price).
    function _quoteForShares(address pair, uint256 lpShares) internal view returns (uint256) {
        uint256 valueUsd8 = Math.mulDiv(lpShares, PairVault(pair).sharePrice(), 1e18);
        return Math.mulDiv(
            valueUsd8,
            10 ** IERC20Metadata(poolQuoteToken).decimals(),
            oracle.getPrice(poolQuoteToken),
            Math.Rounding.Ceil
        );
    }

    /// @dev Initializes the pool at amount1/amount0 and mints a full-range
    ///      position to the creator via PositionManager (funded through
    ///      Permit2). Unused amounts are refunded to the creator.
    function _mintFullRange(PoolKey memory key, uint256 a0, uint256 a1) internal returns (uint256 positionId) {
        IV4PositionManager pm = positionManager;
        uint160 sqrtP = _sqrtPriceX96(a0, a1);
        pm.initializePool(key, sqrtP);

        _permit(key.currency0, a0);
        _permit(key.currency1, a1);
        uint256 bal0 = IERC20(key.currency0).balanceOf(address(this));
        uint256 bal1 = IERC20(key.currency1).balanceOf(address(this));

        positionId = pm.nextTokenId();
        bytes memory actions = abi.encodePacked(uint8(V4Actions.MINT_POSITION), uint8(V4Actions.SETTLE_PAIR));
        bytes[] memory params = new bytes[](2);
        params[0] = abi.encode(
            key,
            POOL_TICK_LOWER,
            POOL_TICK_UPPER,
            _liquidityForAmounts(sqrtP, a0, a1),
            uint128(a0),
            uint128(a1),
            msg.sender,
            bytes("")
        );
        params[1] = abi.encode(key.currency0, key.currency1);
        pm.modifyLiquidities(abi.encode(actions, params), block.timestamp);

        _permit(key.currency0, 0);
        _permit(key.currency1, 0);
        _refundLeftover(key.currency0, bal0, a0);
        _refundLeftover(key.currency1, bal1, a1);
    }

    /// @dev Approve `amount` of `token` to Permit2, then Permit2 -> PositionManager.
    function _permit(address token, uint256 amount) internal {
        IERC20(token).forceApprove(address(permit2), amount);
        permit2.approve(token, address(positionManager), uint160(amount), uint48(block.timestamp));
    }

    /// @dev Whatever the PositionManager did not pull out of `budget` goes back to the creator.
    function _refundLeftover(address token, uint256 balanceBefore, uint256 budget) internal {
        uint256 pulled = balanceBefore - IERC20(token).balanceOf(address(this));
        if (budget > pulled) IERC20(token).safeTransfer(msg.sender, budget - pulled);
    }

    /// @dev Full-range liquidity that both amounts can fund at price `sqrtP`.
    function _liquidityForAmounts(uint160 sqrtP, uint256 a0, uint256 a1) internal pure returns (uint256) {
        require(sqrtP > SQRT_PRICE_LOWER && sqrtP < SQRT_PRICE_UPPER, "PairFactory: price out of range");
        uint256 l0 = Math.mulDiv(a0, Math.mulDiv(sqrtP, SQRT_PRICE_UPPER, Q96), SQRT_PRICE_UPPER - sqrtP);
        uint256 l1 = Math.mulDiv(a1, Q96, sqrtP - SQRT_PRICE_LOWER);
        uint256 l = l0 < l1 ? l0 : l1;
        require(l > 0 && l <= type(uint128).max, "PairFactory: liquidity");
        return l;
    }

    /// @dev sqrt(amount1 / amount0) * 2^96, for raw token amounts.
    function _sqrtPriceX96(uint256 amount0, uint256 amount1) internal pure returns (uint160) {
        require(amount0 > 0 && amount1 > 0, "PairFactory: zero liquidity");
        uint256 s = Math.sqrt(Math.mulDiv(amount1, 1e36, amount0)); // sqrt(ratio) * 1e18
        uint256 p = Math.mulDiv(s, Q96, 1e18);
        require(p > SQRT_PRICE_LOWER && p < SQRT_PRICE_UPPER, "PairFactory: price out of range");
        return uint160(p);
    }
}
