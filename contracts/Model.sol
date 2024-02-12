// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "solmate/src/utils/SignedWadMath.sol";

import { Lien, InterestModel, LienStatus } from "./Structs.sol";

import { FixedInterest } from "./models/FixedInterest.sol";
import { CompoundInterest } from "./models/CompoundInterest.sol";
import { ProRatedFixedInterest } from "./models/ProRatedFixedInterest.sol";

import "hardhat/console.sol";

library Model {
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

    function computePaidThrough(Lien memory lien) public view returns (uint256) {
        if (lien.model == uint8(InterestModel.COMPOUND)) {
            return block.timestamp;
        } else if (lien.model == uint8(InterestModel.FIXED)) {
            return FixedInterest.computePaidThrough(lien);
        } else if (lien.model == uint8(InterestModel.PRO_RATED_FIXED)) {
            return ProRatedFixedInterest.computePaidThrough(lien);
        } else {
            revert InvalidModel();
        }
    }

    function computeNextPaymentDate(Lien memory lien) public view returns (uint256) {
        if (lien.startTime + lien.tenor + lien.defaultPeriod < block.timestamp) {
            return lien.startTime + lien.tenor + lien.defaultPeriod;
        } else if (lien.state.paidThrough + lien.period + lien.defaultPeriod < block.timestamp) {
            return lien.state.paidThrough + lien.period + lien.defaultPeriod;
        } else if (lien.startTime + lien.tenor < block.timestamp) {
            return lien.startTime + lien.tenor + lien.defaultPeriod;
        } else if (lien.state.paidThrough + lien.period < block.timestamp) {
            return lien.state.paidThrough + lien.period + lien.defaultPeriod;
        } else {
            return lien.state.paidThrough + lien.period;
        }
    }

    function computeLienStatus(Lien memory lien) public view returns (uint8) {
        if (lien.startTime + lien.tenor + lien.defaultPeriod < block.timestamp) {
            return uint8(LienStatus.DEFAULTED);
        } else if (lien.state.paidThrough + lien.period + lien.defaultPeriod < block.timestamp) {
            return uint8(LienStatus.DEFAULTED);
        } else if (lien.startTime + lien.tenor < block.timestamp) {
            return uint8(LienStatus.DELINQUENT);
        } else if (lien.state.paidThrough + lien.period < block.timestamp) {
            return uint8(LienStatus.DELINQUENT);
        } else {
            return uint8(LienStatus.CURRENT);
        }
    }
}
