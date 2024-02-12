// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "solmate/src/utils/SignedWadMath.sol";

import { Lien, InterestModel } from "./Structs.sol";

import { FixedInterest } from "./models/FixedInterest.sol";
import { CompoundInterest } from "./models/CompoundInterest.sol";

import "hardhat/console.sol";

library Helpers {
    error InvalidModel();

    function interestPaymentBreakdown(Lien memory lien, uint256 amount) 
        public 
        view 
        returns (
            uint256 amountOwed,
            uint256 feeInterest, 
            uint256 lenderInterest, 
            uint256 principal
        ) 
    {
        (amountOwed, feeInterest, lenderInterest) = computeAmountOwed(lien);

        if (amount > feeInterest + lenderInterest) {
            principal = amount - feeInterest - lenderInterest;
        }
    }

    function computeAmountOwed(Lien memory lien) 
        public 
        view 
        returns (
            uint256 amountOwed,
            uint256 feeInterest,
            uint256 lenderInterest
        ) 
    {
        if (lien.model == uint8(InterestModel.COMPOUND)) {
            (amountOwed, feeInterest, lenderInterest) = CompoundInterest.computeAmountOwed(lien);
        } else if (lien.model == uint8(InterestModel.FIXED)) {
            (amountOwed, feeInterest, lenderInterest) = FixedInterest.computeAmountOwed(lien);
        } else {
            revert InvalidModel();
        }
    }

    function computeLastPaymentTimestamp(Lien memory lien) public view returns (uint256) {
        if (lien.model == uint8(InterestModel.COMPOUND)) {
            return block.timestamp;
        } else if (lien.model == uint8(InterestModel.FIXED)) {
            return FixedInterest.computeLastPaymentTimestamp(lien);
        } else {
            revert InvalidModel();
        }

    }
}
