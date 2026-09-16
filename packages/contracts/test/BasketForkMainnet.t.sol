// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {AllocationController} from "../src/AllocationController.sol";
import {CashbackReserve} from "../src/CashbackReserve.sol";
import {UniswapV3SwapAdapter} from "../src/UniswapV3SwapAdapter.sol";
import {ExecutionRouter} from "../src/ExecutionRouter.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {StrategyVault} from "../src/StrategyVault.sol";
import {ReceiptToken} from "../src/ReceiptToken.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";

interface IUniswapV3FactoryLike {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
}

interface IPeripheryLike {
    function factory() external view returns (address);
}

interface IPoolLike {
    function liquidity() external view returns (uint128);
}

/// @title Fork test: the mainnet basket stack against the live oracle and real Uniswap v3 pools
/// @notice Deploys the basket contracts exactly like DeployMainnetBaskets + CreateMainnetVaults,
///         then deposits a real stock and redeems it. Nothing is broadcast.
///   forge test --match-contract BasketForkMainnetTest --fork-url https://rpc.mainnet.chain.robinhood.com -vv
contract BasketForkMainnetTest is Test {
    using stdJson for string;

    uint24[4] internal FEES = [uint24(100), 500, 3000, 10000];

    address owner;
    address oracle;
    address emergency;
    address swapRouter;
    address usdg;

    AllocationController controller;
    CashbackReserve cashback;
    UniswapV3SwapAdapter adapter;
    ExecutionRouter execRouter;
    VaultFactory factory;

    address user = makeAddr("basket-user");

    function test_fork_basketDepositStockbackRedeem() public {
        if (block.chainid != 4663) {
            emit log("skipped: run with --fork-url <robinhood mainnet rpc>");
            return;
        }
        _loadLaunchpad();
        _deployStack();

        string memory ticker = vm.envOr("BASKET_FORK_TICKER", string("TSLA"));
        string memory mixes = vm.readFile("vault-mixes-4663.json");
        address depositToken = mixes.readAddress(string.concat(".mixes.", ticker, ".depositToken"));
        address[] memory tokens = mixes.readAddressArray(string.concat(".mixes.", ticker, ".tokens"));
        uint256[] memory weights = mixes.readUintArray(string.concat(".mixes.", ticker, ".weightsBps"));

        _ensureFeeds(tokens);
        if (vm.envOr("BASKET_FORK_ROUTE_VIA_USDG", false)) _routeViaUsdg(tokens, depositToken);

        (address vault, address receipt) = factory.createVault(
            VaultFactory.CreateParams({
                depositAsset: depositToken,
                strategy: AllocationController.Strategy.Balanced,
                receiptName: string.concat("Compose ", ticker, " Balanced"),
                receiptSymbol: string.concat("t", ticker, "-B"),
                tvlCapUsd8: 1_000_000e8,
                targetTokens: tokens,
                targetWeightsBps: weights
            })
        );
        execRouter.setAuthorizedCaller(vault, true);
        cashback.setAuthorizedVault(vault, true);
        assertEq(ReceiptToken(receipt).decimals(), 8, "share decimals");

        // Stockback inventory: the reserve pays in the deposit asset.
        uint256 price8 = OracleAdapter(oracle).getPrice(depositToken);
        deal(depositToken, address(this), (10e8 * 1e18) / price8);
        IERC20(depositToken).approve(address(cashback), type(uint256).max);
        cashback.fund(depositToken, IERC20(depositToken).balanceOf(address(this)));

        uint256 depositUsd = vm.envOr("BASKET_FORK_DEPOSIT_USD", uint256(60));
        uint256 amount = (depositUsd * 1e8 * 1e18) / price8;
        deal(depositToken, user, amount);

        vm.startPrank(user);
        IERC20(depositToken).approve(vault, amount);
        uint256 shares = StrategyVault(vault).deposit(amount, 0);
        vm.stopPrank();

        uint256 nav8 = StrategyVault(vault).navUsd8();
        emit log_named_decimal_uint("deposit USD", depositUsd * 1e8, 8);
        emit log_named_decimal_uint("vault NAV after swaps USD", nav8, 8);
        emit log_named_decimal_uint("shares", shares, 8);
        emit log_named_decimal_uint("stockback granted USD", cashback.walletStockbackUsd8(user), 8);
        assertGe(nav8, (depositUsd * 1e8 * 97) / 100, "swaps lost more than 3%");
        assertGt(cashback.walletStockbackUsd8(user), 0, "stockback not granted");

        vm.startPrank(user);
        StrategyVault(vault).redeem(shares / 2, StrategyVault.RedeemMode.ProportionalBasket, 0);
        uint256 before = IERC20(depositToken).balanceOf(user);
        StrategyVault(vault).redeem(ReceiptToken(receipt).balanceOf(user), StrategyVault.RedeemMode.OriginalAsset, 0);
        vm.stopPrank();
        emit log_named_decimal_uint("redeemed back to deposit asset", IERC20(depositToken).balanceOf(user) - before, 18);
        assertEq(ReceiptToken(receipt).balanceOf(user), 0, "shares left");
        assertEq(cashback.walletStockbackUsd8(user), 0, "early redeem forfeits the grant");
    }

    /// @notice A wallet's repeat deposits into one vault each earn their grant until the wallet cap.
    function test_fork_repeatDepositsGrantUpToWalletCap() public {
        if (block.chainid != 4663) {
            emit log("skipped: run with --fork-url <robinhood mainnet rpc>");
            return;
        }
        _loadLaunchpad();
        _deployStack();

        string memory ticker = vm.envOr("BASKET_FORK_TICKER", string("NVDA"));
        string memory mixes = vm.readFile("vault-mixes-4663.json");
        address depositToken = mixes.readAddress(string.concat(".mixes.", ticker, ".depositToken"));
        address[] memory tokens = mixes.readAddressArray(string.concat(".mixes.", ticker, ".tokens"));
        uint256[] memory weights = mixes.readUintArray(string.concat(".mixes.", ticker, ".weightsBps"));
        _ensureFeeds(tokens);
        _routeViaUsdg(tokens, depositToken);
        (address vault,) = factory.createVault(
            VaultFactory.CreateParams({
                depositAsset: depositToken,
                strategy: AllocationController.Strategy.Balanced,
                receiptName: "r",
                receiptSymbol: "r",
                tvlCapUsd8: 1_000_000e8,
                targetTokens: tokens,
                targetWeightsBps: weights
            })
        );
        execRouter.setAuthorizedCaller(vault, true);
        cashback.setAuthorizedVault(vault, true);

        uint256 price8 = OracleAdapter(oracle).getPrice(depositToken);
        deal(depositToken, address(this), (200e8 * 1e18) / price8);
        IERC20(depositToken).approve(address(cashback), type(uint256).max);
        cashback.fund(depositToken, IERC20(depositToken).balanceOf(address(this)));

        uint256 amount = (1_500e8 * 1e18) / price8 + 1;
        deal(depositToken, user, amount * 4);
        vm.startPrank(user);
        IERC20(depositToken).approve(vault, type(uint256).max);
        uint256[4] memory expected = [uint256(10e8), 20e8, 25e8, 25e8];
        for (uint256 i; i < 4; ++i) {
            StrategyVault(vault).deposit(amount, 0);
            emit log_named_decimal_uint("wallet stockback USD", cashback.walletStockbackUsd8(user), 8);
            assertEq(cashback.walletStockbackUsd8(user), expected[i], "grant");
        }
        vm.stopPrank();
    }

    /// @notice Lists which Uniswap v3 pools exist between each basket token and USDG / each other.
    function test_fork_listPools() public {
        if (block.chainid != 4663) return;
        _loadLaunchpad();
        string memory mixes = vm.readFile("vault-mixes-4663.json");
        address[] memory tokens = mixes.readAddressArray(".mixes.TSLA.tokens");
        string[] memory tickers = mixes.readStringArray(".mixes.TSLA.tickers");
        IUniswapV3FactoryLike uni = IUniswapV3FactoryLike(IPeripheryLike(swapRouter).factory());
        for (uint256 i; i < tokens.length; ++i) {
            if (tokens[i] == usdg) continue;
            for (uint256 f; f < FEES.length; ++f) {
                address pool = uni.getPool(tokens[i], usdg, FEES[f]);
                if (pool == address(0)) continue;
                emit log_named_string("pool vs USDG", string.concat(tickers[i], " fee ", vm.toString(FEES[f])));
                emit log_named_decimal_uint("  USDG depth", IERC20(usdg).balanceOf(pool), 6);
                emit log_named_uint("  liquidity", IPoolLike(pool).liquidity());
            }
            address direct = uni.getPool(tokens[i], tokens[0], 3000);
            if (direct != address(0) && i != 0) emit log_named_string("direct 0.3% pool with first token", tickers[i]);
        }
    }

    function _loadLaunchpad() internal {
        string memory lp = vm.readFile("deployments-mainnet-launchpad.json");
        owner = lp.readAddress(".contracts.owner");
        oracle = lp.readAddress(".contracts.oracle");
        emergency = lp.readAddress(".contracts.emergency");
        swapRouter = lp.readAddress(".contracts.swapRouter");
        usdg = lp.readAddress(".contracts.usdg");
    }

    function _deployStack() internal {
        controller = new AllocationController(address(this));
        cashback = new CashbackReserve(address(this));
        cashback.setOracle(oracle, 100);
        adapter = new UniswapV3SwapAdapter(address(this), swapRouter);
        execRouter = new ExecutionRouter(address(this), address(adapter));
        adapter.setAuthorizedCaller(address(execRouter), true);
        factory = new VaultFactory(address(this), oracle, address(controller), address(cashback), emergency, address(execRouter));
        execRouter.setEmergency(emergency);
        factory.setUsdStableAsset(usdg);
        controller.setApprovedAsset(usdg, true);
        execRouter.setApprovedToken(usdg, true);
    }

    /// @dev Approves the mix tokens and gives any token without a live feed (META before onboarding)
    ///      a fork-only feed at the onboard price.
    function _ensureFeeds(address[] memory tokens) internal {
        string memory onboard = vm.readFile("mainnet-onboard.json");
        address[] memory addrs = onboard.readAddressArray(".addresses");
        uint256[] memory prices = onboard.readUintArray(".prices");
        for (uint256 i; i < tokens.length; ++i) {
            controller.setApprovedAsset(tokens[i], true);
            execRouter.setApprovedToken(tokens[i], true);
            if (OracleAdapter(oracle).hasFeed(tokens[i])) {
                try OracleAdapter(oracle).getPrice(tokens[i]) returns (uint256) {
                    continue;
                } catch {}
            }
            for (uint256 j; j < addrs.length; ++j) {
                if (addrs[j] != tokens[i]) continue;
                address feed = address(new MockOracle(int256(prices[j])));
                vm.prank(owner);
                OracleAdapter(oracle).setPriceFeed(tokens[i], feed);
                emit log_named_address("fork-only feed for", tokens[i]);
            }
        }
    }

    /// @dev stock → USDG → stock paths through the deepest USDG pool of each token.
    function _routeViaUsdg(address[] memory tokens, address depositToken) internal {
        IUniswapV3FactoryLike uni = IUniswapV3FactoryLike(IPeripheryLike(swapRouter).factory());
        for (uint256 i; i < tokens.length; ++i) {
            if (tokens[i] == depositToken) continue;
            uint24 feeIn = _bestUsdgFee(uni, depositToken);
            if (tokens[i] == usdg) {
                adapter.setPairPath(depositToken, usdg, abi.encodePacked(depositToken, feeIn, usdg));
                adapter.setPairPath(usdg, depositToken, abi.encodePacked(usdg, feeIn, depositToken));
                continue;
            }
            uint24 feeOut = _bestUsdgFee(uni, tokens[i]);
            adapter.setPairPath(depositToken, tokens[i], abi.encodePacked(depositToken, feeIn, usdg, feeOut, tokens[i]));
            adapter.setPairPath(tokens[i], depositToken, abi.encodePacked(tokens[i], feeOut, usdg, feeIn, depositToken));
            adapter.setPairPath(tokens[i], usdg, abi.encodePacked(tokens[i], feeOut, usdg));
        }
    }

    function _bestUsdgFee(IUniswapV3FactoryLike uni, address token) internal view returns (uint24 best) {
        uint256 depth;
        for (uint256 f; f < FEES.length; ++f) {
            address pool = uni.getPool(token, usdg, FEES[f]);
            if (pool == address(0)) continue;
            uint256 d = IERC20(usdg).balanceOf(pool);
            if (d > depth) (depth, best) = (d, FEES[f]);
        }
        require(best != 0, "no USDG pool");
    }
}
