// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "solmate/src/utils/SignedWadMath.sol";

import { Lien, InterestModel } from "./Structs.sol";

import { FixedInterest } from "./models/FixedInterest.sol";
import { CompoundInterest } from "./models/CompoundInterest.sol";
import { ProRatedFixedInterest } from "./models/ProRatedFixedInterest.sol";

import "hardhat/console.sol";

library Helpers {
    error InvalidModel();

    function interestPaymentBreakdown(Lien memory lien, uint256 amount, bool proRata) 
        public 
        view 
        returns (
            uint256 amountOwed,
            uint256 feeInterest, 
            uint256 lenderInterest, 
            uint256 principal
        ) 
    {
        (amountOwed, feeInterest, lenderInterest) = computeAmountOwed(lien, proRata);

        if (amount > feeInterest + lenderInterest) {
            principal = amount - feeInterest - lenderInterest;
        }
    }

    function computeAmountOwed(Lien memory lien, bool proRata) 
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
        } else if (lien.model == uint8(InterestModel.PRO_RATED_FIXED)) {
            (amountOwed, feeInterest, lenderInterest) = ProRatedFixedInterest.computeAmountOwed(lien, proRata);
        } else {
            revert InvalidModel();
        }
    }

    function computeLastPaymentTimestamp(Lien memory lien) public view returns (uint256) {
        if (lien.model == uint8(InterestModel.COMPOUND)) {
            return block.timestamp;
        } else if (lien.model == uint8(InterestModel.FIXED)) {
            return FixedInterest.computeLastPaymentTimestamp(lien);
        } else if (lien.model == uint8(InterestModel.PRO_RATED_FIXED)) {
            return ProRatedFixedInterest.computeLastPaymentTimestamp(lien);
        } else {
            revert InvalidModel();
        }
    }
}
