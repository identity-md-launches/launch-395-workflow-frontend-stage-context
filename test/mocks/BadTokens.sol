// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";

/// @notice `balanceOf` always reverts.
contract RevertingBalanceToken {
    function balanceOf(address) external pure returns (uint256) {
        revert("balanceOf: no");
    }
}

/// @notice `balanceOf` returns a well-formed word followed by extra bytes (64 bytes total).
contract LongReturnToken {
    function balanceOf(address) external pure returns (uint256, uint256) {
        return (type(uint256).max, type(uint256).max);
    }
}

/// @notice `balanceOf` returns fewer than 32 bytes.
contract ShortReturnToken {
    fallback() external {
        assembly {
            mstore(0x00, 0xff)
            return(0x00, 31)
        }
    }
}

/// @notice `balanceOf` returns nothing at all.
contract EmptyReturnToken {
    fallback() external {}
}

/// @notice `balanceOf` loops until every unit of forwarded gas is gone.
contract GasBurningToken {
    function balanceOf(address) external pure returns (uint256) {
        uint256 i;
        while (true) {
            i++;
        }
        return i;
    }
}

/// @notice `balanceOf` tries to write state in the pool manager. Inside the hook's `staticcall` that write is
/// forbidden, so the call reverts and the hook treats the balance as zero.
contract ReenteringToken {
    IPoolManager immutable manager;

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    function balanceOf(address) external returns (uint256) {
        manager.unlock("");
        return type(uint256).max;
    }
}
