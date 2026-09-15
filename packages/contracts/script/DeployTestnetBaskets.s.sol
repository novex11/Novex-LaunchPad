// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {OracleAdapter} from "../src/OracleAdapter.sol";
import {AllocationController} from "../src/AllocationController.sol";
import {CashbackReserve} from "../src/CashbackReserve.sol";
import {UniswapV3SwapAdapter} from "../src/UniswapV3SwapAdapter.sol";
import {ExecutionRouter} from "../src/ExecutionRouter.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {StrategyVault} from "../src/StrategyVault.sol";
import {VaultMixes} from "./VaultMixes.sol";

/// @title DeployTestnetBaskets — managed baskets on Robinhood Chain testnet
/// @notice Testnet has no Uniswap, so the basket stack trades through the same
///         oracle-priced OracleSwapRouter the PairRouter uses (it implements the
///         SwapRouter02 `exactInput` interface, so the mainnet UniswapV3SwapAdapter
///         runs unchanged). Deploys AllocationController, CashbackReserve,
///         UniswapV3SwapAdapter, ExecutionRouter and VaultFactory on the live
///         oracle / emergency registry, approves the faucet stocks + WETH + TestUSDG,
///         and creates one Balanced vault per stock with the fixed target mix from
///         vault-mixes-46630.json (pnpm mixes:testnet). Writes
///         deployments-testnet-baskets.json.
///
///   TESTNET_ORACLE, TESTNET_EMERGENCY, TESTNET_SWAP_ROUTER, TESTNET_USDG  existing deployment
///   CASHBACK_FUND_BPS  share of the deployer's balance of each stock moved into the
///                      Stockback reserve (default 1000 = 10%; 0 disables)
contract DeployTestnetBaskets is Script {
    uint256 constant CHAIN_ID = 46630;
    uint256 constant TVL_CAP_USD8 = 1_000_000e8;
    address constant WETH = 0x7943e237c7F95DA44E0301572D358911207852Fa;

    AllocationController public controller;
    CashbackReserve public cashback;
    UniswapV3SwapAdapter public adapter;
    ExecutionRouter public execRouter;
    VaultFactory public factory;

    string[] vaultTickers;
    address[] vaultAddrs;
    address[] receiptAddrs;

    address deployer;
    address oracle;
    address emergency;
    address swapRouter;
    address usdg;
    uint256 cashbackFundBps;
    string mixes;

    function run() external {
        require(block.chainid == CHAIN_ID, "DeployTestnetBaskets: wrong chain");
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        deployer = vm.addr(pk);
        oracle = vm.envAddress("TESTNET_ORACLE");
        emergency = vm.envAddress("TESTNET_EMERGENCY");
        swapRouter = vm.envAddress("TESTNET_SWAP_ROUTER");
        usdg = vm.envAddress("TESTNET_USDG");
        cashbackFundBps = vm.envOr("CASHBACK_FUND_BPS", uint256(1000));
        require(OracleAdapter(oracle).owner() == deployer, "DeployTestnetBaskets: deployer does not own the oracle");

        mixes = VaultMixes.load(CHAIN_ID);
        string[] memory tickers = vm.parseJsonKeys(mixes, ".mixes");
        require(tickers.length > 0, "DeployTestnetBaskets: no mixes");

        vm.startBroadcast(pk);

        controller = new AllocationController(deployer);
        cashback = new CashbackReserve(deployer);
        cashback.setOracle(oracle, 100);
        adapter = new UniswapV3SwapAdapter(deployer, swapRouter);
        execRouter = new ExecutionRouter(deployer, address(adapter));
        adapter.setAuthorizedCaller(address(execRouter), true);
        execRouter.setEmergency(emergency);
        execRouter.setOracle(oracle);
        factory = new VaultFactory(deployer, oracle, address(controller), address(cashback), emergency, address(execRouter));
        factory.setUsdStableAsset(usdg);

        _approve(usdg);
        _approve(WETH);
        for (uint256 i; i < tickers.length; ++i) {
            (address[] memory mixTokens, ) = VaultMixes.get(mixes, tickers[i]);
            for (uint256 j; j < mixTokens.length; ++j) {
                if (!controller.approvedAssets(mixTokens[j])) _approve(mixTokens[j]);
            }
        }

        for (uint256 i; i < tickers.length; ++i) {
            _createVault(tickers[i]);
        }

        vm.stopBroadcast();

        _export();
    }

    function _createVault(string memory ticker) internal {
        address depositToken = vm.parseJsonAddress(mixes, string.concat(".mixes.", ticker, ".depositToken"));
        require(OracleAdapter(oracle).hasFeed(depositToken), string.concat("DeployTestnetBaskets: no feed for ", ticker));
        (address[] memory mixTokens, uint256[] memory mixWeights) = VaultMixes.get(mixes, ticker);
        (address vault, address receipt) = factory.createVault(
            VaultFactory.CreateParams({
                depositAsset: depositToken,
                strategy: AllocationController.Strategy.Balanced,
                receiptName: string.concat("Compose ", ticker, " Balanced"),
                receiptSymbol: string.concat("t", ticker, "-B"),
                tvlCapUsd8: TVL_CAP_USD8,
                targetTokens: mixTokens,
                targetWeightsBps: mixWeights
            })
        );
        execRouter.setAuthorizedCaller(vault, true);
        cashback.setAuthorizedVault(vault, true);
        vaultTickers.push(ticker);
        vaultAddrs.push(vault);
        receiptAddrs.push(receipt);
        _fundCashback(depositToken);
    }

    /// @dev Seed the Stockback reserve from the deployer's faucet balance.
    function _fundCashback(address token) internal {
        if (cashbackFundBps == 0) return;
        uint256 amount = (IERC20(token).balanceOf(deployer) * cashbackFundBps) / 10_000;
        if (amount == 0) return;
        IERC20(token).approve(address(cashback), amount);
        cashback.fund(token, amount);
    }

    function _approve(address token) internal {
        controller.setApprovedAsset(token, true);
        execRouter.setApprovedToken(token, true);
    }

    function _export() internal {
        vm.serializeAddress("contracts", "allocationController", address(controller));
        vm.serializeAddress("contracts", "cashbackReserve", address(cashback));
        vm.serializeAddress("contracts", "swapAdapter", address(adapter));
        vm.serializeAddress("contracts", "executionRouter", address(execRouter));
        string memory contractsJson = vm.serializeAddress("contracts", "vaultFactory", address(factory));

        string memory vaultsJson = "{}";
        for (uint256 i; i < vaultTickers.length; ++i) {
            string memory objKey = string.concat("vault:", vaultTickers[i]);
            vm.serializeAddress(objKey, "vault", vaultAddrs[i]);
            string memory obj = vm.serializeAddress(objKey, "receipt", receiptAddrs[i]);
            vaultsJson = vm.serializeString("vaults", vaultTickers[i], obj);
        }

        vm.serializeUint("root", "chainId", block.chainid);
        vm.serializeAddress("root", "oracle", oracle);
        vm.serializeAddress("root", "emergency", emergency);
        vm.serializeAddress("root", "swapRouter", swapRouter);
        vm.serializeAddress("root", "usdg", usdg);
        vm.serializeString("root", "contracts", contractsJson);
        string memory out = vm.serializeString("root", "vaults", vaultsJson);
        vm.writeJson(out, "./deployments-testnet-baskets.json");

        console2.log("AllocationController:", address(controller));
        console2.log("CashbackReserve:     ", address(cashback));
        console2.log("UniswapV3SwapAdapter:", address(adapter));
        console2.log("ExecutionRouter:     ", address(execRouter));
        console2.log("VaultFactory:        ", address(factory));
        for (uint256 i; i < vaultTickers.length; ++i) {
            console2.log(string.concat("  t", vaultTickers[i], "-B"), vaultAddrs[i]);
        }
    }
}
