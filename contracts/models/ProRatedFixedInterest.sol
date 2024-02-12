// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import "solmate/src/utils/SignedWadMath.sol";

import { Lien } from "../Structs.sol";

import "hardhat/console.sol";

library ProRatedFixedInterest {
    int256 private constant _YEAR_WAD = 365 days * 1e18;
    uint256 private constant _LIQUIDATION_THRESHOLD = 100_000;
    uint256 private constant _BASIS_POINTS = 10_000;

    function computeAmountOwed(Lien memory lien, bool proRata)
        public 
        view 
        returns (
            uint256 amountOwed,
            uint256 feeInterest,
            uint256 lenderInterest
        ) 
    {   
        // if the loan is paid up to date, return no interest
        if (block.timestamp < lien.state.paidThrough) {
            return (lien.state.amountOwed, 0, 0);
        }

        bool inDefault = false;
        if (block.timestamp > lien.state.paidThrough + lien.period) {
            inDefault = true;
        }

        uint256 endPeriod;
        if (inDefault) {
            if (proRata) {
                endPeriod = Math.min(block.timestamp, lien.state.paidThrough + (lien.period * 2));
            } else {
                endPeriod = lien.state.paidThrough + lien.period * 2;
            }
        } else {
            if (proRata) {
                endPeriod = Math.min(block.timestamp, lien.state.paidThrough + lien.period);
            } else {
                endPeriod = lien.state.paidThrough + lien.period;
            }
        }

        uint256 amountWithoutFee;
        if (inDefault) {
            uint256 missedInterestWithoutFee = computeCurrentDebt(
                lien.state.amountOwed, 
                lien.defaultRate,
                lien.state.paidThrough, 
                lien.state.paidThrough + lien.period
            ) - lien.state.amountOwed;

            amountWithoutFee = missedInterestWithoutFee + computeCurrentDebt(
                lien.state.amountOwed, 
                lien.rate, 
                lien.state.paidThrough + lien.period, 
                endPeriod
            );

            uint256 missedInterest = computeCurrentDebt(
                lien.state.amountOwed,
                lien.defaultRate + lien.fee, 
                lien.state.paidThrough, 
                lien.state.paidThrough + lien.period
            ) - lien.state.amountOwed;

            amountOwed = missedInterest + computeCurrentDebt(
                lien.state.amountOwed,
                lien.rate + lien.fee, 
                lien.state.paidThrough + lien.period, 
                endPeriod
            );
        } else {
            amountWithoutFee = computeCurrentDebt(
                lien.state.amountOwed, 
                lien.rate, 
                lien.state.paidThrough, 
                endPeriod
            );
            amountOwed = computeCurrentDebt(
                lien.state.amountOwed, 
                lien.rate + lien.fee, 
                lien.state.paidThrough, 
                endPeriod
            );
        }

        lenderInterest = amountWithoutFee - lien.state.amountOwed;
        feeInterest = amountOwed - amountWithoutFee;
    }

    // function computeProRatedPeriod(uint256 paidThrough, uint256 period) public view returns (uint256) {

        
    // }

    /**
     * @dev Computes the current debt of a borrow given the last time it was touched and the last computed debt.
     * @param amount Principal in ETH
     * @param startTime Start time of the loan
     * @param rate Interest rate (in bips)
     * @dev Formula: https://www.desmos.com/calculator/l6omp0rwnh
     */
    function computeCurrentDebt(
        uint256 amount,
        uint256 rate,
        uint256 startTime,
        uint256 endTime
    ) public view returns (uint256) {
        uint256 loanTime = endTime - startTime;
        int256 yearsWad = wadDiv(int256(loanTime) * 1e18, _YEAR_WAD);
        return amount + uint256(wadMul(int256(amount), wadMul(yearsWad, bipsToSignedWads(rate))));
    }

    /**
     * @dev Converts an integer bips value to a signed wad value.
     */
    function bipsToSignedWads(uint256 bips) public pure returns (int256) {
        return int256((bips * 1e18) / _BASIS_POINTS);
    }

    function computeLastPaymentTimestamp(Lien memory lien) public view returns (uint256) {
        if (block.timestamp > lien.state.paidThrough + lien.period) {
            return lien.state.paidThrough + lien.period * 2;
        }

        uint256 paidThrough = lien.state.paidThrough;
        if (paidThrough > block.timestamp) return paidThrough;
        return paidThrough + lien.period;
    }
}
