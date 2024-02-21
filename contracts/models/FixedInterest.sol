// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import "solmate/src/utils/SignedWadMath.sol";

import { Lien, LienStatus } from "../Structs.sol";

import "hardhat/console.sol";

library FixedInterest {
    int256 private constant _YEAR_WAD = 365 days * 1e18;
    uint256 private constant _LIQUIDATION_THRESHOLD = 100_000;
    uint256 private constant _BASIS_POINTS = 10_000;

    function computeAmountOwed(Lien memory lien)
        public 
        view 
        returns (
            uint256 amountOwed,
            uint256 pastInterest,
            uint256 pastFee,
            uint256 currentInterest,
            uint256 currentFee
        ) 
    {   
        // if the loan is paid up to date, return no interest
        if (block.timestamp < lien.state.paidThrough) {
            return (lien.state.amountOwed, 0, 0, 0, 0);
        }

        bool inDefault = false;
        if (block.timestamp > lien.state.paidThrough + lien.period) {
            inDefault = true;
        }

        bool pastTenor = false;
        if (block.timestamp > lien.startTime + lien.tenor) {
            pastTenor = true;
        }

        if (inDefault) {
            pastInterest = computeCurrentDebt(
                lien.state.amountOwed, 
                lien.rate, 
                lien.period
            ) - lien.state.amountOwed;

            pastFee = computeCurrentDebt(
                lien.state.amountOwed, 
                lien.fee,
                lien.period
            ) - lien.state.amountOwed;
        }

        if (!pastTenor) {
            currentInterest = computeCurrentDebt(
                lien.state.amountOwed, 
                lien.rate, 
                lien.period
            ) - lien.state.amountOwed;

            currentFee = computeCurrentDebt(
                lien.state.amountOwed, 
                lien.fee, 
                lien.period
            ) - lien.state.amountOwed;
        }

        if (inDefault) {
            amountOwed = lien.state.amountOwed + pastInterest + pastFee + currentInterest + currentFee;
        } else {
            amountOwed = lien.state.amountOwed + currentInterest + currentFee;
        }
    }

    /**
     * @dev Computes the current debt of a borrow given the last time it was touched and the last computed debt.
     * @param amount Principal in ETH
     * @param rate Interest rate (in bips)
     * @param period Period in seconds
     */
    function computeCurrentDebt(
        uint256 amount,
        uint256 rate,
        uint256 period
    ) public view returns (uint256) {
        int256 yearsWad = wadDiv(int256(period) * 1e18, _YEAR_WAD);
        return amount + uint256(wadMul(int256(amount), wadMul(yearsWad, bipsToSignedWads(rate))));
    }

    /**
     * @dev Converts an integer bips value to a signed wad value.
     */
    function bipsToSignedWads(uint256 bips) public pure returns (int256) {
        return int256((bips * 1e18) / _BASIS_POINTS);
    }

    function computePaidThrough(Lien memory lien, bool cureOnly) public view returns (uint256) {
        if (block.timestamp > lien.state.paidThrough + lien.period) {
            if (cureOnly) {
                return lien.state.paidThrough + lien.period;
            } else {
                return lien.state.paidThrough + (lien.period * 2);
            }
        }

        uint256 paidThrough = lien.state.paidThrough;
        if (paidThrough > block.timestamp) return paidThrough;
        return paidThrough + lien.period;
    }

    function computeDelinquentPaymentDate(Lien memory lien) public view returns (uint256) {
        if (lien.startTime + lien.tenor < block.timestamp) {
            return lien.startTime + lien.tenor + lien.gracePeriod;
        } else if (lien.state.paidThrough + lien.period < block.timestamp) {
            return lien.state.paidThrough + lien.period + lien.gracePeriod;
        } else {
            return lien.state.paidThrough + lien.period;
        }
    }

    function computeNextPaymentDate(Lien memory lien) public view returns (uint256) {
        if (lien.startTime + lien.tenor + lien.gracePeriod < block.timestamp) {
            return lien.startTime + lien.tenor + lien.gracePeriod;
        } else if (lien.state.paidThrough + lien.period + lien.gracePeriod < block.timestamp) {
            return lien.state.paidThrough + lien.period + lien.gracePeriod;
        } else if (lien.startTime + lien.tenor < block.timestamp) {
            return lien.startTime + lien.tenor + lien.gracePeriod;
        } else if (lien.state.paidThrough + lien.period < block.timestamp) {
            return lien.state.paidThrough + lien.period + lien.gracePeriod;
        } else {
            return lien.state.paidThrough + lien.period;
        }
    }

    function computeLienStatus(Lien memory lien) public view returns (uint8) {
        if (lien.startTime + lien.tenor + lien.gracePeriod < block.timestamp) {
            return uint8(LienStatus.DEFAULTED);
        } else if (lien.state.paidThrough + lien.period + lien.gracePeriod < block.timestamp) {
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
