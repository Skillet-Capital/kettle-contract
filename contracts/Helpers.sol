// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "solmate/src/utils/SignedWadMath.sol";

import { Lien, LienState, InterestModel } from "./Structs.sol";

import { FixedInterest } from "./models/FixedInterest.sol";
import { CompoundInterest } from "./models/CompoundInterest.sol";

import "hardhat/console.sol";

library Helpers {
    error InvalidModel();

    function interestPaymentBreakdown(
        Lien memory lien, 
        LienState memory state, 
        uint256 amount
    ) 
        public 
        view 
        returns (
            uint256 amountOwed,
            uint256 feeInterest, 
            uint256 lenderInterest, 
            uint256 principal
        ) 
    {
        (amountOwed, feeInterest, lenderInterest) = computeAmountOwed(lien, state);

        if (amount > feeInterest + lenderInterest) {
            principal = amount - feeInterest - lenderInterest;
        }
    }

    function computeAmountOwed(
        Lien memory lien,
        LienState memory state
    ) 
        public 
        view 
        returns (
            uint256 amountOwed,
            uint256 feeInterest,
            uint256 lenderInterest
        ) 
    {
        if (lien.model == uint8(InterestModel.COMPOUND)) {
            (amountOwed, feeInterest, lenderInterest) = CompoundInterest.computeAmountOwed(lien, state);
        } else if (lien.model == uint8(InterestModel.FIXED)) {
            (amountOwed, feeInterest, lenderInterest) = FixedInterest.computeAmountOwed(lien, state);
        } else {
            revert InvalidModel();
        }
    }

    function computePaidThrough(Lien memory lien, LienState memory state) public view returns (uint256) {
        if (lien.model == uint8(InterestModel.COMPOUND)) {
            return block.timestamp;
        } else if (lien.model == uint8(InterestModel.FIXED)) {
            return FixedInterest.computePaidThrough(lien, state);
        } else {
            revert InvalidModel();
        }

    }
}
