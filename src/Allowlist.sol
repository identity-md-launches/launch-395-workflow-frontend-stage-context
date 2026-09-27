// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "solmate/src/tokens/ERC20.sol";

/// @title Allowlist (ALST)
/// @notice Fixed-supply launch token. The whole supply is minted once, to the deployer, in the constructor.
/// @dev No constructor arguments, no owner, no mint path after construction, no pause, no proxy. The
/// launch factory deploys it, receives the entire supply, seeds the pool with part of it and distributes
/// the rest as launch rewards. Holding at least 1 ALST is what `AllowlistLaunchHook` checks during the
/// launch window, so any wallet that receives 1 ALST is, by that fact alone, on the allowlist.
contract Allowlist is ERC20 {
    /// @notice Total supply, fixed at construction: 1,000,000,000 ALST with 18 decimals.
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000e18;

    constructor() ERC20("Allowlist", "ALST", 18) {
        _mint(msg.sender, TOTAL_SUPPLY);
    }
}
